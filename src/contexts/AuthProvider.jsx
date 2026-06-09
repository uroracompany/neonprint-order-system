import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";
import { AuthContext } from "./authStateContext";
import {
  clearCachedAuthSession,
  getAuthSession,
  refreshAuthSession,
  setCachedAuthSession,
  signOutAuth,
} from "../utils/authManager";

const PROFILE_COLUMNS = "id, name, email, role, employment_status";

export function AuthProvider({ children }) {
  const activeRef = useRef(true);
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .single();

    if (error) throw error;
    if (activeRef.current) setProfile(data || null);
    return data || null;
  }, []);

  const applySession = useCallback(async (nextSession) => {
    setCachedAuthSession(nextSession);

    const nextUser = nextSession?.user || null;
    if (activeRef.current) {
      setSession(nextSession || null);
      setUser(nextUser);
      setProfile(nextUser ? undefined : null);
    }

    if (nextUser?.id) {
      await loadProfile(nextUser.id);
    }
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setAuthError(null);

    try {
      const nextSession = await refreshAuthSession();
      await applySession(nextSession);
      return nextSession;
    } catch (error) {
      clearCachedAuthSession();
      if (activeRef.current) {
        setSession(null);
        setUser(null);
        setProfile(null);
        setAuthError(error);
      }
      return null;
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [applySession]);

  const signOut = useCallback(async () => {
    await signOutAuth();
    if (activeRef.current) {
      setSession(null);
      setUser(null);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;

    const initialize = async () => {
      setLoading(true);
      setAuthError(null);

      try {
        const initialSession = await getAuthSession();
        await applySession(initialSession);
      } catch (error) {
        clearCachedAuthSession();
        if (activeRef.current) {
          setSession(null);
          setUser(null);
          setProfile(null);
          setAuthError(error);
        }
      } finally {
        if (activeRef.current) setLoading(false);
      }
    };

    initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession).catch((error) => {
        if (activeRef.current) {
          setProfile(null);
          setAuthError(error);
        }
      });
    });

    return () => {
      activeRef.current = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const profileChannel = supabase
      .channel(`auth-profile-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => {
          if (payload.new) setProfile(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [user?.id]);

  const value = useMemo(() => ({
    session,
    user,
    profile,
    loading,
    authError,
    refresh,
    signOut,
  }), [authError, loading, profile, refresh, session, signOut, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
