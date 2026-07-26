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
  const [mfaLevel, setMfaLevel] = useState(null);
  const [hasVerifiedMfaFactor, setHasVerifiedMfaFactor] = useState(false);
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

  const loadMfaLevel = useCallback(async (nextSession) => {
    if (!nextSession?.access_token) {
      if (activeRef.current) {
        setMfaLevel(null);
        setHasVerifiedMfaFactor(false);
      }
      return null;
    }

    if (activeRef.current) {
      setMfaLevel(undefined);
      setHasVerifiedMfaFactor(undefined);
    }

    const [aalResult, factorsResult] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);

    if (aalResult.error) throw aalResult.error;
    if (factorsResult.error) throw factorsResult.error;

    const nextLevel = aalResult.data?.currentLevel || null;
    const factorGroups = [
      factorsResult.data?.totp,
      factorsResult.data?.phone,
      factorsResult.data?.webauthn,
    ];
    const hasVerifiedFactor = factorGroups.some((factors) => (
      Array.isArray(factors) && factors.some((factor) => factor.status === "verified")
    ));

    if (activeRef.current) {
      setMfaLevel(nextLevel);
      setHasVerifiedMfaFactor(hasVerifiedFactor);
    }
    return nextLevel;
  }, []);

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
        setMfaLevel(null);
        setHasVerifiedMfaFactor(false);
      } else if (shouldShowProfileLoading) {
        updateProfile(undefined);
      }
    }

    const tasks = [];
    if (shouldLoadProfile) tasks.push(loadProfile(nextUser.id));
    if (nextUser) tasks.push(loadMfaLevel(nextSession));

    if (tasks.length) {
      await Promise.all(tasks);
    }
  }, [loadMfaLevel, loadProfile, updateProfile]);

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
        setMfaLevel(null);
        setHasVerifiedMfaFactor(false);
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
        setMfaLevel(null);
        setHasVerifiedMfaFactor(false);
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
          setMfaLevel(null);
          setHasVerifiedMfaFactor(false);
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
          setMfaLevel(null);
          setHasVerifiedMfaFactor(false);
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
    mfaLevel,
    hasVerifiedMfaFactor,
    refresh,
    signOut,
  }), [authError, hasVerifiedMfaFactor, loading, mfaLevel, profile, refresh, session, signOut, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
