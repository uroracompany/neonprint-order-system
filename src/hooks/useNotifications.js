import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../supabaseClient";

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

export default function useNotifications(userId) {
  // ============= ESTADOS =============
  const [notifications, setNotifications] = useState([]); // Todas las notificaciones del usuario
  const [loading, setLoading] = useState(true); // Indica si se están cargando notificaciones
  const [toasts, setToasts] = useState([]); // Toasts flotantes activos (últimas 3)
  
  // Referencias para limpiar timeouts de toasts
  const toastTimeouts = useRef({});
  // Referencia al canal de Supabase para suscripción en tiempo real
  const channelRef = useRef(null);

  // Contar notificaciones no leídas (excluyendo archivadas)
  const unreadCount = notifications.filter((n) => !n.is_read && !n.is_archived).length;

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

  // ============= FUNCIÓN: CARGAR NOTIFICACIONES =============
  // Consulta las últimas 50 notificaciones del usuario desde BD
  const fetchNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) {
      setNotifications(data);
    }
    setLoading(false);
  }, [userId]);

  // ============= EFECTO 1: CARGA INICIAL =============
  // Se ejecuta cuando cambia el userId
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchNotifications();
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchNotifications]);

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
          
          // Actualizar lista de notificaciones (máximo 50)
          setNotifications((prev) => {
            if (prev.some(n => n.id === newNotif.id)) return prev;
            return [newNotif, ...prev].slice(0, 50);
          });

          // Mostrar toast flotante (máximo 3)
          const toastId = `${newNotif.id}-toast`;
          if (!toastTimeouts.current[toastId]) {
            setToasts((prev) => {
              if (prev.some(t => t.id === newNotif.id)) return prev;
              return [newNotif, ...prev].slice(0, MAX_TOASTS);
            });
            
            // Auto-cerrar el toast después de 5 segundos
            toastTimeouts.current[toastId] = setTimeout(() => {
              dismissToast(newNotif.id);
            }, NOTIFICATION_DURATION);
          }
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
          setNotifications((prev) =>
            prev.map((n) => (n.id === payload.new.id ? { ...n, ...payload.new } : n))
          );
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
      }
      Object.values(toastTimeouts.current).forEach(clearTimeout);
      toastTimeouts.current = {};
    };
  }, [userId, dismissToast]);

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

      setNotifications((prev) => {
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev].slice(0, 50);
      });

      return notification;
    },
    [userId]
  );

  const markAsRead = useCallback(async (id) => {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);
    if (!error) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    const unreadIds = notifications
      .filter((n) => !n.is_read)
      .map((n) => n.id);
    if (unreadIds.length === 0) return;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", unreadIds);
    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
  }, [notifications]);

  const archive = useCallback(async (id) => {
    const { error } = await supabase
      .from("notifications")
      .update({ is_archived: true })
      .eq("id", id);
    if (!error) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_archived: true } : n))
      );
    }
  }, []);

  const deleteNotification = useCallback(async (id) => {
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id);
    if (!error) {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }
  }, []);

  const showActionNotification = useCallback(
    async ({ type = "info", title, label, message, orderId = null, orderTitle = null, metadata = {} }) => {
      const notification = await createNotification({
        type,
        title: title || label || message,
        message,
        orderId,
        metadata: { ...metadata, order_title: orderTitle || null },
      });
      if (notification) {
        const toastId = `${notification.id}-toast`;
        if (!toastTimeouts.current[toastId]) {
          setToasts((prev) => {
            if (prev.some((t) => t.id === notification.id)) return prev;
            return [notification, ...prev].slice(0, MAX_TOASTS);
          });
          toastTimeouts.current[toastId] = setTimeout(() => {
            dismissToast(notification.id);
          }, NOTIFICATION_DURATION);
        }
      }
    },
    [createNotification, dismissToast]
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
