import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { filterActiveNotifications, getActiveUnreadCount, isActiveNotification } from "../utils/notifications";

// ============= HOOK USENOTIFICATIONS =============
// Este hook gestiona todo el sistema de notificaciones de la aplicación
// Incluye:
// 1. Notificaciones de base de datos (persistentes)
// 2. Toasts flotantes (temporales)
// 3. Suscripción en tiempo real a cambios de notificaciones
// 4. Manejo de lectura/archivo de notificaciones

// Constantes de configuración
const NOTIFICATION_DURATION = 5000; // Toast desaparece después de 5 segundos
const MAX_TOASTS = 3; // Máximo de toasts visibles simultáneamente
const LOCAL_TOAST_PREFIX = "local-toast";

const getNotificationEventKind = (notification) =>
  notification?.metadata?.event_kind || "";

const sameNotificationFingerprint = (notification, target) =>
  notification?.user_id === target?.user_id &&
  notification?.type === target?.type &&
  (notification?.order_id || null) === (target?.order_id || null) &&
  notification?.title === target?.title &&
  notification?.message === target?.message &&
  getNotificationEventKind(notification) === getNotificationEventKind(target);

const removeNotificationFamily = (items, id) => {
  const target = items.find((notification) => notification.id === id);
  if (!target) {
    return items.filter((notification) => notification.id !== id);
  }
  return items.filter((notification) => !sameNotificationFingerprint(notification, target));
};

export default function useNotifications(userId) {
  // ============= ESTADOS =============
  const [notifications, setNotifications] = useState([]); // Todas las notificaciones del usuario
  const [loading, setLoading] = useState(true); // Indica si se están cargando notificaciones
  const [toasts, setToasts] = useState([]); // Toasts flotantes activos (últimas 3)
  
  // Referencias para limpiar timeouts de toasts
  const notificationsRef = useRef([]);
  const toastTimeouts = useRef({});
  const localToastCounter = useRef(0);
  const fetchVersionRef = useRef(0);
  // Referencia al canal de Supabase para suscripción en tiempo real
  const channelRef = useRef(null);

  // Contar notificaciones no leídas (excluyendo archivadas)
  const unreadCount = getActiveUnreadCount(notifications);

  // ============= FUNCIÓN: CERRAR TOAST =============
  // Elimina un toast de la pantalla y limpia su timeout
  const dismissToast = useCallback((notificationId) => {
    setToasts((prev) => prev.filter((t) => t.id !== notificationId));
    const toastId = `${notificationId}-toast`;
    if (toastTimeouts.current[toastId]) {
      clearTimeout(toastTimeouts.current[toastId]);
      delete toastTimeouts.current[toastId];
    }
  }, []);

  const clearToastTimeouts = useCallback(() => {
    Object.values(toastTimeouts.current).forEach(clearTimeout);
    toastTimeouts.current = {};
  }, []);

  // ============= FUNCIÓN: CARGAR NOTIFICACIONES =============
  // Consulta las últimas 50 notificaciones del usuario desde BD
  const enqueueToast = useCallback((notification) => {
    if (!isActiveNotification(notification)) return;

    const toastId = `${notification.id}-toast`;
    if (toastTimeouts.current[toastId]) return;

    setToasts((prev) => {
      if (prev.some((t) => t.id === notification.id || sameNotificationFingerprint(t, notification))) return prev;
      return [notification, ...prev].slice(0, MAX_TOASTS);
    });

    toastTimeouts.current[toastId] = setTimeout(() => {
      dismissToast(notification.id);
    }, NOTIFICATION_DURATION);
  }, [dismissToast]);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  const fetchNotifications = useCallback(async ({ showNewToasts = false } = {}) => {
    const fetchVersion = ++fetchVersionRef.current;
    if (!userId) {
      setNotifications([]);
      notificationsRef.current = [];
      setToasts([]);
      clearToastTimeouts();
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .or("is_archived.is.false,is_archived.is.null")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (fetchVersion !== fetchVersionRef.current) return;

    if (!error && data) {
      const visibleNotifications = filterActiveNotifications(data);
      const previousIds = new Set(notificationsRef.current.map((notification) => notification.id));
      const newNotifications = showNewToasts
        ? visibleNotifications.filter((notification) => !previousIds.has(notification.id))
        : [];

      notificationsRef.current = visibleNotifications;
      setNotifications(visibleNotifications);

      [...newNotifications].reverse().forEach(enqueueToast);
    }
    setLoading(false);
  }, [clearToastTimeouts, enqueueToast, userId]);

  // ============= EFECTO 1: CARGA INICIAL =============
  // Se ejecuta cuando cambia el userId
  useEffect(() => {
    fetchVersionRef.current += 1;
    notificationsRef.current = [];
    setNotifications([]);
    setToasts([]);
    clearToastTimeouts();

    const timer = setTimeout(() => {
      fetchNotifications();
    }, 0);

    return () => clearTimeout(timer);
  }, [clearToastTimeouts, fetchNotifications, userId]);

  // ============= EFECTO 2: SUSCRIPCIÓN EN TIEMPO REAL =============
  // Se suscribe a cambios en la tabla "notifications"
  // Maneja: INSERT (nuevas), UPDATE (marcadas como leídas, archivadas), DELETE (eliminadas)
  useEffect(() => {
    if (!userId) return;

    channelRef.current = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Cuando llega una notificación nueva
          const newNotif = payload.new;
          if (!isActiveNotification(newNotif)) return;
          
          // Actualizar lista de notificaciones (máximo 50)
          setNotifications((prev) => {
            if (prev.some(n => n.id === newNotif.id)) return prev;
            return [newNotif, ...prev].slice(0, 50);
          });

          enqueueToast(newNotif);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Cuando se actualiza una notificación (leída, archivada, etc.)
          const updatedNotif = payload.new;
          if (!isActiveNotification(updatedNotif)) {
            setNotifications((prev) => removeNotificationFamily(prev, updatedNotif.id));
            setToasts((prev) => removeNotificationFamily(prev, updatedNotif.id));
            return;
          }

          setNotifications((prev) => {
            if (prev.some((n) => n.id === updatedNotif.id)) {
              return prev.map((n) => (n.id === updatedNotif.id ? { ...n, ...updatedNotif } : n));
            }
            return [updatedNotif, ...prev].slice(0, 50);
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
          setToasts((prev) => prev.filter((t) => t.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      clearToastTimeouts();
    };
  }, [clearToastTimeouts, userId, enqueueToast]);

  const createNotification = useCallback(
    async ({ type, title, message, orderId = null, metadata = {} }) => {
      if (!userId) return null;
      const { data: notificationId, error } = await supabase.rpc("create_notification", {
        p_user_id: userId,
        p_type: type,
        p_title: title,
        p_message: message,
        p_order_id: orderId,
        p_metadata: metadata,
      });

      if (error) {
        console.error("Error creating notification:", error);
        return null;
      }

      const { data: notification, error: fetchError } = await supabase
        .from("notifications")
        .select("*")
        .eq("id", notificationId)
        .single();

      if (fetchError) {
        console.error("Error loading notification:", fetchError);
        return null;
      }

      if (!isActiveNotification(notification)) {
        return null;
      }

      setNotifications((prev) => {
        if (prev.some((n) => n.id === notification.id || sameNotificationFingerprint(n, notification))) return prev;
        return [notification, ...prev].slice(0, 50);
      });

      return notification;
    },
    [userId]
  );

  const markAsRead = useCallback(async (id) => {
    if (!userId) return;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", userId);
    if (!error) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    }
  }, [userId]);

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    const unreadIds = notifications
      .filter((n) => !n.is_read && isActiveNotification(n))
      .map((n) => n.id);
    if (unreadIds.length === 0) return;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", unreadIds)
      .eq("user_id", userId);
    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
  }, [notifications, userId]);

  const archive = useCallback(async (id) => {
    const { error } = await supabase.rpc("archive_notification", {
      p_notification_id: id,
    });
    if (!error) {
      setNotifications((prev) => removeNotificationFamily(prev, id));
      setToasts((prev) => removeNotificationFamily(prev, id));
    }
  }, []);

  const deleteNotification = useCallback(async (id) => {
    const { error } = await supabase.rpc("dismiss_notification", {
      p_notification_id: id,
    });
    if (!error) {
      setNotifications((prev) => removeNotificationFamily(prev, id));
      setToasts((prev) => removeNotificationFamily(prev, id));
    }
  }, []);

  const showActionNotification = useCallback(
    async ({ type = "info", title, label, message, orderId = null, orderTitle = null, metadata = {} }) => {
      const resolvedTitle = title || label || message;
      const resolvedMetadata = { ...metadata, order_title: orderTitle || null };
      localToastCounter.current += 1;
      const optimisticNotification = {
        id: `${LOCAL_TOAST_PREFIX}-${Date.now()}-${localToastCounter.current}`,
        user_id: userId || null,
        type,
        title: resolvedTitle,
        message,
        order_id: orderId,
        metadata: resolvedMetadata,
        created_at: new Date().toISOString(),
        is_read: true,
        is_archived: false,
        deleted_at: null,
      };

      enqueueToast(optimisticNotification);

      const notification = await createNotification({
        type,
        title: resolvedTitle,
        message,
        orderId,
        metadata: resolvedMetadata,
      });
      if (notification) enqueueToast(notification);
    },
    [createNotification, enqueueToast, userId]
  );

  return {
    notifications,
    unreadCount,
    loading,
    toasts,
    createNotification,
    markAsRead,
    markAllAsRead,
    archive,
    deleteNotification,
    dismissToast,
    showActionNotification,
    refresh: fetchNotifications,
  };
}
