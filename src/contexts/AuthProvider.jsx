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
  const userIdRef = useRef(null);
  const profileRef = useRef(undefined);
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const updateProfile = useCallback((nextProfile) => {
    profileRef.current = nextProfile;
    if (activeRef.current) setProfile(nextProfile);
  }, []);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      updateProfile(null);
      return null;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .single();

    if (error) throw error;
    updateProfile(data || null);
    return data || null;
  }, [updateProfile]);

  const applySession = useCallback(async (nextSession, event = "UNKNOWN") => {
    setCachedAuthSession(nextSession);

    const nextUser = nextSession?.user || null;
    const previousUserId = userIdRef.current;
    const nextUserId = nextUser?.id || null;
    const isSameUser = Boolean(nextUserId && previousUserId === nextUserId);
    const isTokenRefreshForSameUser = event === "TOKEN_REFRESHED" && isSameUser;
    const shouldLoadProfile = Boolean(nextUserId && !isTokenRefreshForSameUser);
    const shouldShowProfileLoading = Boolean(nextUserId && (!isSameUser || profileRef.current === undefined));

    if (activeRef.current) {
      setSession(nextSession || null);
      setUser(nextUser);
      userIdRef.current = nextUserId;

      if (!nextUser) {
        updateProfile(null);
      } else if (shouldShowProfileLoading) {
        updateProfile(undefined);
      }
    }

    if (shouldLoadProfile) {
      await loadProfile(nextUser.id);
    }
  }, [loadProfile, updateProfile]);

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
        userIdRef.current = null;
        updateProfile(null);
        setAuthError(error);
      }
      return null;
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [applySession, updateProfile]);

  const signOut = useCallback(async () => {
    await signOutAuth();
    if (activeRef.current) {
      setSession(null);
      setUser(null);
      userIdRef.current = null;
      updateProfile(null);
    }
  }, [updateProfile]);

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
          userIdRef.current = null;
          updateProfile(null);
          setAuthError(error);
        }
      } finally {
        if (activeRef.current) setLoading(false);
      }
    };

    initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      void applySession(nextSession, event).catch((error) => {
        if (activeRef.current) {
          updateProfile(null);
          setAuthError(error);
        }
      });
    });

    return () => {
      activeRef.current = false;
      subscription.unsubscribe();
    };
  }, [applySession, updateProfile]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const profileChannel = supabase
      .channel(`auth-profile-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => {
          if (payload.new) updateProfile(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [updateProfile, user?.id]);

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
