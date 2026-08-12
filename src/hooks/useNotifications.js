import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import {
  filterActiveNotifications,
  filterArchivedNotifications,
  getActiveUnreadCount,
  isActiveNotification,
  isArchivedNotification,
} from "../utils/notifications";

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
const MAX_NOTIFICATION_ROWS = 300;

const getNotificationEventKind = (notification) =>
  notification?.metadata?.event_kind || "";

const sameNotificationFingerprint = (notification, target) =>
  notification?.user_id === target?.user_id &&
  notification?.type === target?.type &&
  (notification?.order_id || null) === (target?.order_id || null) &&
  notification?.title === target?.title &&
  notification?.message === target?.message &&
  getNotificationEventKind(notification) === getNotificationEventKind(target);

const removeNotificationById = (items, id) =>
  items.filter((notification) => notification.id !== id);

export default function useNotifications(userId) {
  // ============= ESTADOS =============
  const [notifications, setNotifications] = useState([]); // Todas las notificaciones del usuario
  const [archivedNotifications, setArchivedNotifications] = useState([]);
  const [archivedLoading, setArchivedLoading] = useState(true);
  const [loading, setLoading] = useState(true); // Indica si se están cargando notificaciones
  const [toasts, setToasts] = useState([]); // Toasts flotantes activos (últimas 3)
  
  // Referencias para limpiar timeouts de toasts
  const notificationsRef = useRef([]);
  const archivedNotificationsRef = useRef([]);
  const toastTimeouts = useRef({});
  const localToastCounter = useRef(0);
  const fetchVersionRef = useRef(0);
  const archivedFetchVersionRef = useRef(0);
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

  useEffect(() => {
    archivedNotificationsRef.current = archivedNotifications;
  }, [archivedNotifications]);

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
      .limit(MAX_NOTIFICATION_ROWS);

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

  const fetchArchivedNotifications = useCallback(async () => {
    const fetchVersion = ++archivedFetchVersionRef.current;
    if (!userId) {
      setArchivedNotifications([]);
      archivedNotificationsRef.current = [];
      setArchivedLoading(false);
      return;
    }

    setArchivedLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .eq("is_archived", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTIFICATION_ROWS);

    if (fetchVersion !== archivedFetchVersionRef.current) return;

    if (!error && data) {
      const archivedRows = filterArchivedNotifications(data);
      archivedNotificationsRef.current = archivedRows;
      setArchivedNotifications(archivedRows);
    }
    setArchivedLoading(false);
  }, [userId]);

  // ============= EFECTO 1: CARGA INICIAL =============
  // Se ejecuta cuando cambia el userId
  useEffect(() => {
    fetchVersionRef.current += 1;
    archivedFetchVersionRef.current += 1;
    notificationsRef.current = [];
    archivedNotificationsRef.current = [];
    setNotifications([]);
    setArchivedNotifications([]);
    setToasts([]);
    clearToastTimeouts();

    const timer = setTimeout(() => {
      fetchNotifications();
      fetchArchivedNotifications();
    }, 0);

    return () => clearTimeout(timer);
  }, [clearToastTimeouts, fetchArchivedNotifications, fetchNotifications, userId]);

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
            return [newNotif, ...prev].slice(0, MAX_NOTIFICATION_ROWS);
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
          if (isArchivedNotification(updatedNotif)) {
            setNotifications((prev) => removeNotificationById(prev, updatedNotif.id));
            setToasts((prev) => removeNotificationById(prev, updatedNotif.id));
            setArchivedNotifications((prev) => {
              const next = prev.filter((n) => n.id !== updatedNotif.id);
              return [updatedNotif, ...next].slice(0, MAX_NOTIFICATION_ROWS);
            });
            return;
          }

          if (!isActiveNotification(updatedNotif)) {
            setNotifications((prev) => removeNotificationById(prev, updatedNotif.id));
            setToasts((prev) => removeNotificationById(prev, updatedNotif.id));
            setArchivedNotifications((prev) => prev.filter((n) => n.id !== updatedNotif.id));
            return;
          }

          setArchivedNotifications((prev) => prev.filter((n) => n.id !== updatedNotif.id));
          setNotifications((prev) => {
            if (prev.some((n) => n.id === updatedNotif.id)) {
              return prev.map((n) => (n.id === updatedNotif.id ? { ...n, ...updatedNotif } : n));
            }
            return [updatedNotif, ...prev].slice(0, MAX_NOTIFICATION_ROWS);
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
          setArchivedNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
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
        return [notification, ...prev].slice(0, MAX_NOTIFICATION_ROWS);
      });

      return notification;
    },
    [userId]
  );

  const refreshAfterFailedMutation = useCallback(async () => {
    await Promise.all([fetchNotifications(), fetchArchivedNotifications()]);
  }, [fetchArchivedNotifications, fetchNotifications]);

  const markAsRead = useCallback(async (id) => {
    if (!userId) {
      return { ok: false, message: "Tu sesión no está disponible. Inicia sesión nuevamente." };
    }

    const { data, error } = await supabase.rpc("mark_notification_read", {
      p_notification_id: id,
    });

    if (error || data !== 1) {
      await refreshAfterFailedMutation();
      return { ok: false, message: "No se pudo marcar la notificación como leída. Inténtalo nuevamente." };
    }

    setNotifications((prev) => prev.map((notification) => (
      notification.id === id
        ? { ...notification, is_read: true, read_at: new Date().toISOString() }
        : notification
    )));
    return { ok: true };
  }, [refreshAfterFailedMutation, userId]);

  const markAllAsRead = useCallback(async () => {
    if (!userId) {
      return { ok: false, message: "Tu sesión no está disponible. Inicia sesión nuevamente." };
    }
    const unreadIds = notifications
      .filter((n) => !n.is_read && isActiveNotification(n))
      .map((n) => n.id);
    if (unreadIds.length === 0) return { ok: true };

    const results = await Promise.all(unreadIds.map((id) => supabase.rpc("mark_notification_read", {
      p_notification_id: id,
    })));
    const persistedIds = new Set(results.reduce((ids, { data, error }, index) => {
      if (!error && data === 1) ids.push(unreadIds[index]);
      return ids;
    }, []));

    if (persistedIds.size !== unreadIds.length || unreadIds.some((id) => !persistedIds.has(id))) {
      await refreshAfterFailedMutation();
      return { ok: false, message: "No se pudieron marcar todas las notificaciones como leídas. La bandeja se actualizó." };
    }

    setNotifications((prev) => prev.map((notification) => {
      return persistedIds.has(notification.id)
        ? { ...notification, is_read: true, read_at: new Date().toISOString() }
        : notification;
    }));
    return { ok: true };
  }, [notifications, refreshAfterFailedMutation, userId]);

  const archive = useCallback(async (id) => {
    const target = notificationsRef.current.find((notification) => notification.id === id);
    const { data, error } = await supabase.rpc("archive_notification", {
      p_notification_id: id,
    });

    if (error || data !== 1) {
      await refreshAfterFailedMutation();
      return { ok: false, message: "No se pudo archivar la notificación. La bandeja se actualizó." };
    }

    setNotifications((prev) => removeNotificationById(prev, id));
    setToasts((prev) => removeNotificationById(prev, id));
    if (target) {
      const archivedNotification = {
        ...target,
        is_archived: true,
        archived_at: new Date().toISOString(),
      };
      setArchivedNotifications((prev) => {
        const next = removeNotificationById(prev, id);
        return [archivedNotification, ...next].slice(0, MAX_NOTIFICATION_ROWS);
      });
    }
    return { ok: true };
  }, [refreshAfterFailedMutation]);

  const deleteNotification = useCallback(async (id) => {
    const { data, error } = await supabase.rpc("dismiss_notification", {
      p_notification_id: id,
    });

    if (error || data !== 1) {
      await refreshAfterFailedMutation();
      return { ok: false, message: "No se pudo eliminar la notificación. La bandeja se actualizó." };
    }

    setNotifications((prev) => removeNotificationById(prev, id));
    setArchivedNotifications((prev) => removeNotificationById(prev, id));
    setToasts((prev) => removeNotificationById(prev, id));
    return { ok: true };
  }, [refreshAfterFailedMutation]);

  const deleteNotificationsByScope = useCallback(async (scope = "all") => {
    if (!userId) {
      return { ok: false, message: "Tu sesión no está disponible. Inicia sesión nuevamente." };
    }
    const localIds = new Set(
      (scope === "archived" ? archivedNotificationsRef.current : scope === "active" ? notificationsRef.current : [
        ...notificationsRef.current,
        ...archivedNotificationsRef.current,
      ]).map((notification) => notification.id)
    );

    let query = supabase
      .from("notifications")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (scope === "active") {
      query = query.or("is_archived.is.false,is_archived.is.null");
    } else if (scope === "archived") {
      query = query.eq("is_archived", true);
    }

    const { data, error } = await query.select("id");
    const persistedIds = new Set((data || []).map((notification) => notification.id));
    const missedLocalRows = [...localIds].some((id) => !persistedIds.has(id));
    if (error || !Array.isArray(data) || missedLocalRows) {
      await refreshAfterFailedMutation();
      return { ok: false, message: "No se pudieron eliminar las notificaciones. La bandeja se actualizó." };
    }

    if (scope === "active") {
      setNotifications([]);
      notificationsRef.current = [];
      setToasts([]);
    } else if (scope === "archived") {
      setArchivedNotifications([]);
      archivedNotificationsRef.current = [];
    } else {
      setNotifications([]);
      setArchivedNotifications([]);
      notificationsRef.current = [];
      archivedNotificationsRef.current = [];
      setToasts([]);
    }
    return { ok: true };
  }, [refreshAfterFailedMutation, userId]);

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
    archivedNotifications,
    archivedCount: archivedNotifications.length,
    unreadCount,
    loading,
    archivedLoading,
    toasts,
    createNotification,
    markAsRead,
    markAllAsRead,
    archive,
    deleteNotification,
    deleteNotificationsByScope,
    dismissToast,
    showActionNotification,
    refresh: fetchNotifications,
    refreshArchived: fetchArchivedNotifications,
  };
}
