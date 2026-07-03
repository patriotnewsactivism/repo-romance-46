import { useMutation, useQuery } from "@tanstack/react-query";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { Card, PrimaryButton } from "@/components/UI";
import { getPreferences, updatePreferences } from "@/lib/api-client";

export default function Settings() {
  const colors = useColors();
  const { ready, session } = useProtectedRoute();
  const { signOut } = useAuth();

  const prefsQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: () => getPreferences(),
    enabled: ready,
  });

  const updateMut = useMutation({
    mutationFn: (prefs: Record<string, unknown>) => updatePreferences(prefs),
    onSuccess: () => prefsQuery.refetch(),
  });

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const prefs = prefsQuery.data as Record<string, unknown> | undefined;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Card>
        <Text style={styles.sectionLabel}>// account</Text>
        <Text style={{ color: colors.foreground, fontSize: 14, marginTop: 8 }}>
          {session?.user.email}
        </Text>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.sectionLabel}>// analysis preferences</Text>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }}>
              Include forked repos
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>
              Analyze forks alongside your own repos
            </Text>
          </View>
          <Switch
            value={Boolean(prefs?.include_forks)}
            onValueChange={(v) => updateMut.mutate({ ...(prefs ?? {}), include_forks: v })}
            trackColor={{ true: colors.primary, false: colors.muted }}
          />
        </View>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }}>
              Include archived repos
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>
              Analyze archived / read-only repos
            </Text>
          </View>
          <Switch
            value={Boolean(prefs?.include_archived)}
            onValueChange={(v) => updateMut.mutate({ ...(prefs ?? {}), include_archived: v })}
            trackColor={{ true: colors.primary, false: colors.muted }}
          />
        </View>
      </Card>

      <View style={{ marginTop: 24 }}>
        <PrimaryButton label="Sign out" variant="destructive" onPress={() => signOut()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 40 },
  sectionLabel: { color: "#9199a5", fontSize: 12, fontFamily: "Inter_500Medium" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
  },
});
