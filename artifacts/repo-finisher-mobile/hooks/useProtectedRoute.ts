import { useEffect } from "react";
import { useRouter } from "expo-router";

import { useAuth } from "@/contexts/AuthContext";

/**
 * Mirrors web's ProtectedRoute component: redirects to /auth once we know
 * there is no session. Screens should render a loading state while
 * `loading` is true.
 */
export function useProtectedRoute() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/auth");
    }
  }, [loading, session, router]);

  return { session, loading, ready: !loading && !!session };
}
