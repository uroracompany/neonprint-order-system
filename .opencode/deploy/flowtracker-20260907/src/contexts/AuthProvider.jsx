import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";
import { AuthContext } from "./authStateContext";
import {
  clearCachedAuthSession,
  consumeAuthNotice,
  getAuthSession,
  maintainAuthSession,
  setCachedAuthSession,
  signOutAuth,
  startAuthSessionMonitor,
  subscribeToAuthInvalidation,
} from "../utils/authManager";
import { AUTH_NOTICE, getLoginErrorCode } from "../utils/authFeedback";
import { getAuthProfile } from "../utils/authProfile";
import { getAuthMfaState } from "../utils/authMfa";

export function AuthProvider({ children }) {
  const activeRef = useRef(true);
  const userIdRef = useRef(null);
  const sessionGenerationRef = useRef(0);
  const mfaRequestGenerationRef = useRef(0);
  const profileRef = useRef(undefined);
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(undefined);
  const [mfaLevel, setMfaLevel] = useState(null);
  const [hasVerifiedMfaFactor, setHasVerifiedMfaFactor] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authNotice, setAuthNotice] = useState(null);

  const updateProfile = useCallback((nextProfile) => {
    profileRef.current = nextProfile;
    if (activeRef.current) setProfile(nextProfile);
  }, []);

  const clearAuthState = useCallback(({ notice = null, error = null, clearNotice = false } = {}) => {
    clearCachedAuthSession();
    if (!activeRef.current) return;

    setSession(null);
    setUser(null);
    userIdRef.current = null;
    updateProfile(null);
    setMfaLevel(null);
    setHasVerifiedMfaFactor(false);
    setAuthError(error);

    if (clearNotice) {
      setAuthNotice(null);
      return;
    }

    const pendingNotice = notice || consumeAuthNotice();
    if (pendingNotice) setAuthNotice(pendingNotice);
  }, [updateProfile]);

  const loadProfile = useCallback(async (userId, isCurrent = () => true) => {
    if (!userId) {
      updateProfile(null);
      return null;
    }

    let data;
    try {
      data = await getAuthProfile(userId);
    } catch (error) {
      throw Object.assign(error, { code: AUTH_NOTICE.PROFILE_UNAVAILABLE });
    }
    if (isCurrent()) updateProfile(data || null);
    return data || null;
  }, [updateProfile]);

  const loadMfaLevel = useCallback(async (nextSession, {
    force = false,
    preserveCurrent = false,
    isCurrent = () => true,
  } = {}) => {
    if (!nextSession?.access_token) {
      if (isCurrent()) {
        setMfaLevel(null);
        setHasVerifiedMfaFactor(false);
      }
      return null;
    }

    const requestGeneration = mfaRequestGenerationRef.current + 1;
    mfaRequestGenerationRef.current = requestGeneration;
    const isMfaCurrent = () => isCurrent() && mfaRequestGenerationRef.current === requestGeneration;

    if (isMfaCurrent() && !preserveCurrent) {
      setMfaLevel(undefined);
      setHasVerifiedMfaFactor(undefined);
    }

    const { currentLevel: nextLevel, factors } = await getAuthMfaState(nextSession.user?.id, { force });
    if (!isMfaCurrent()) return null;
    const factorGroups = [
      factors?.totp,
      factors?.phone,
      factors?.webauthn,
    ];
    const hasVerifiedFactor = factorGroups.some((factors) => (
      Array.isArray(factors) && factors.some((factor) => factor.status === "verified")
    ));

    if (isMfaCurrent()) {
      setMfaLevel(nextLevel);
      setHasVerifiedMfaFactor(hasVerifiedFactor);
    }
    return nextLevel;
  }, []);

  const applySession = useCallback(async (nextSession, event = "UNKNOWN") => {
    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    const nextUserId = nextSession?.user?.id || null;
    const isCurrent = () => (
      activeRef.current
      && sessionGenerationRef.current === generation
      && userIdRef.current === nextUserId
    );
    setCachedAuthSession(nextSession);

    const nextUser = nextSession?.user || null;
    const previousUserId = userIdRef.current;
    const isSameUser = Boolean(nextUserId && previousUserId === nextUserId);
    // Session events for the same identity are background maintenance. They
    // must never make the protected route look like a fresh application boot.
    const isSessionMaintenanceForSameUser = isSameUser && [
      "TOKEN_REFRESHED",
      "INITIAL_SESSION",
      "SIGNED_IN",
    ].includes(event);
    const isTokenRefreshForSameUser = event === "TOKEN_REFRESHED" && isSameUser;
    // A redundant sign-in event may still be a useful profile check (for
    // example, after reconnecting). It is safe because the existing profile
    // stays rendered until the refreshed value is confirmed.
    const shouldLoadProfile = Boolean(nextUserId && !isTokenRefreshForSameUser);
    const shouldShowProfileLoading = Boolean(nextUserId && (!isSameUser || profileRef.current === undefined));

    if (activeRef.current) {
      setSession(nextSession || null);
      setUser(nextUser);
      userIdRef.current = nextUserId;
      if (nextUser) setAuthError(null);

      if (!nextUser) {
        updateProfile(null);
        setMfaLevel(null);
        setHasVerifiedMfaFactor(false);
        const pendingNotice = consumeAuthNotice();
        if (pendingNotice) setAuthNotice(pendingNotice);
      } else if (shouldShowProfileLoading) {
        updateProfile(undefined);
        setAuthNotice(null);
      }
    }

    let nextProfile = profileRef.current;
    try {
      if (shouldLoadProfile) {
        nextProfile = await loadProfile(nextUser.id, isCurrent);
      }
      if (!isCurrent()) return;

      // MFA is an administrator-only startup dependency. Other roles should
      // be able to render as soon as their profile has been validated.
      if (nextUser && nextProfile?.role === "admin") {
        await loadMfaLevel(nextSession, {
          preserveCurrent: isSessionMaintenanceForSameUser,
          isCurrent,
        });
      } else if (nextUser && isCurrent()) {
        setMfaLevel(null);
        setHasVerifiedMfaFactor(false);
      }
    } catch (error) {
      if (isCurrent()) {
        updateProfile(undefined);
        setMfaLevel(null);
        setHasVerifiedMfaFactor(false);
        setAuthError({ code: AUTH_NOTICE.PROFILE_UNAVAILABLE, cause: error });
      }
      throw error;
    }
  }, [loadMfaLevel, loadProfile, updateProfile]);

  const refresh = useCallback(async () => {
    setBackgroundRefreshing(true);
    setAuthError(null);

    try {
      const nextSession = await maintainAuthSession({ forceRefresh: true, invalidateAtExpiry: true });
      if (!nextSession) return null;
      await applySession(nextSession);
      return nextSession;
    } catch (error) {
      clearAuthState({ notice: getLoginErrorCode(error), error });
      return null;
    } finally {
      if (activeRef.current) setBackgroundRefreshing(false);
    }
  }, [applySession, clearAuthState]);

  const signOut = useCallback(async () => {
    await signOutAuth();
    clearAuthState({ clearNotice: true });
  }, [clearAuthState]);

  useEffect(() => {
    activeRef.current = true;

    const initialize = async () => {
      setInitialLoading(true);
      setAuthError(null);

      try {
        const initialSession = await getAuthSession();
        await applySession(initialSession);
      } catch (error) {
        clearAuthState({ notice: getLoginErrorCode(error), error });
      } finally {
        if (activeRef.current) setInitialLoading(false);
      }
    };

    const stopSessionMonitor = startAuthSessionMonitor();
    const unsubscribeInvalidation = subscribeToAuthInvalidation(({ notice }) => {
      clearAuthState({ notice });
    });

    initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      void applySession(nextSession, event).catch(() => undefined);
    });

    return () => {
      activeRef.current = false;
      subscription.unsubscribe();
      unsubscribeInvalidation();
      stopSessionMonitor();
    };
  }, [applySession, clearAuthState, updateProfile]);

  useEffect(() => {
    if (!user?.id || profile?.role !== "admin") return undefined;

    const handleMfaVerified = (event) => {
      if (event.detail?.userId && event.detail.userId !== user.id) return;
      if (!session?.access_token) return;

      setMfaLevel(undefined);
      setHasVerifiedMfaFactor(undefined);
      const expectedUserId = user.id;
      void loadMfaLevel(session, {
        force: true,
        preserveCurrent: true,
        isCurrent: () => activeRef.current && userIdRef.current === expectedUserId,
      }).catch(() => {
        // Keep the protected route blocked if the post-verification refresh
        // cannot confirm the new assurance level.
        if (activeRef.current && userIdRef.current === expectedUserId) {
          setMfaLevel("aal1");
          setHasVerifiedMfaFactor(true);
        }
      });
    };

    window.addEventListener("neonprint:mfa-verified", handleMfaVerified);
    return () => window.removeEventListener("neonprint:mfa-verified", handleMfaVerified);
  }, [loadMfaLevel, profile?.role, session, user?.id]);

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
    // `loading` remains as a compatibility alias for consumers that only need
    // the initial route gate. Background work is deliberately separate.
    loading: initialLoading,
    initialLoading,
    backgroundRefreshing,
    authError,
    authNotice,
    mfaLevel,
    hasVerifiedMfaFactor,
    refresh,
    signOut,
  }), [authError, authNotice, backgroundRefreshing, hasVerifiedMfaFactor, initialLoading, mfaLevel, profile, refresh, session, signOut, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
