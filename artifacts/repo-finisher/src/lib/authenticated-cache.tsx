import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Identity {
  userId: string | null;
  generation: number;
  ready: boolean;
}

interface AuthenticatedCacheScope extends Identity {
  /** Also rejects late responses after signing out and back in as the same user. */
  isCurrent: () => boolean;
}

const AuthenticatedCacheContext = createContext<AuthenticatedCacheScope | null>(null);

/** Bind private queries to the hydrated Supabase identity, not a rotating token. */
export function AuthenticatedCacheProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const identityRef = useRef<Identity>({ userId: null, generation: 0, ready: false });
  const liveRef = useRef(false);
  const [identity, setIdentity] = useState(identityRef.current);

  useEffect(() => {
    liveRef.current = true;
    let live = true;
    let authEvents = 0;

    const resolveIdentity = (userId: string | null) => {
      if (!live) return;
      const previous = identityRef.current;
      if (previous.ready && previous.userId === userId) return;
      const next = { userId, generation: previous.generation + 1, ready: true };
      // Advance the generation before cancelling requests so late mutation and
      // manual-refresh responses cannot put the previous account's data back.
      identityRef.current = next;
      if (previous.ready) queryClient.clear();
      setIdentity(next);
    };

    // Subscribe first: a SIGNED_OUT/SIGNED_IN event must win over an older
    // getSession result that was still hydrating when the event arrived.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEvents += 1;
      resolveIdentity(session?.user.id ?? null);
    });
    const hydrationEvent = authEvents;
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (authEvents === hydrationEvent) resolveIdentity(sessionData.session?.user.id ?? null);
    }).catch(() => {
      if (authEvents === hydrationEvent) resolveIdentity(null);
    });

    return () => {
      live = false;
      liveRef.current = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const scope = useMemo<AuthenticatedCacheScope>(() => ({
    ...identity,
    isCurrent: () => liveRef.current
      && identity.ready
      && identityRef.current.generation === identity.generation
      && identityRef.current.userId === identity.userId,
  }), [identity]);

  return (
    <AuthenticatedCacheContext.Provider value={scope}>
      {/* Keep the initial auth hydration mounted, but clear every private local
          state/observer as well as cached data when the resolved user changes. */}
      <Fragment key={Math.max(0, identity.generation - 1)}>{children}</Fragment>
    </AuthenticatedCacheContext.Provider>
  );
}

export function useAuthenticatedCacheScope() {
  const scope = useContext(AuthenticatedCacheContext);
  if (!scope) throw new Error("AuthenticatedCacheProvider is required for private repository history.");
  return scope;
}
