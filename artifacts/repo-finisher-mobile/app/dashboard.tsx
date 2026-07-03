import { useCallback } from "react";
import { useRouter, useFocusEffect } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { TopBar } from "@/components/TopBar";
import { Badge, Card, PrimaryButton } from "@/components/UI";
import {
  deleteAnalysis,
  disconnectGithub,
  getConnectionStatus,
  getPortfolioSummary,
  listAnalyses,
  runAnalysis,
  startGithubOAuth,
} from "@/lib/api-client";

export default function Dashboard() {
  const colors = useColors();
  const router = useRouter();
  const { ready } = useProtectedRoute();
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ["gh-status"],
    queryFn: () => getConnectionStatus(),
    enabled: ready,
  });
  const portfolio = useQuery({
    queryKey: ["gh-portfolio"],
    queryFn: () => getPortfolioSummary(),
    enabled: ready && !!status.data?.connected,
  });
  const analysesQuery = useQuery({
    queryKey: ["analyses"],
    queryFn: () => listAnalyses(),
    enabled: ready,
  });
  const analysesList = (analysesQuery.data?.analyses ?? []) as Record<string, unknown>[];

  useFocusEffect(
    useCallback(() => {
      if (ready) {
        status.refetch();
        portfolio.refetch();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]),
  );

  const connectMut = useMutation({
    mutationFn: () => startGithubOAuth(),
    onSuccess: (res) => {
      Linking.openURL(res.url);
    },
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectGithub(),
    onSuccess: () => {
      status.refetch();
      portfolio.refetch();
    },
  });

  const runMut = useMutation({
    mutationFn: () => runAnalysis(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      router.push(`/analysis/${res.id}`);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAnalysis(id),
    onSuccess: () => analysesQuery.refetch(),
  });

  const connected = status.data?.connected;
  const summary = portfolio.data?.summary;

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar />
      <FlatList
        data={analysesList}
        keyExtractor={(item) => item.id as string}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            <View>
              <Text style={[styles.h1, { color: colors.foreground }]}>
                <Text style={{ color: colors.primary }}>$</Text> dashboard
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 4 }}>
                Connect GitHub, then run an analysis. We'll rank what to finish, combine, or
                repurpose.
              </Text>
            </View>

            <Card>
              <View style={styles.row}>
                <Feather name="github" size={24} color={colors.foreground} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    GitHub connection
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                    {status.isLoading
                      ? "checking…"
                      : connected
                        ? `connected as ${status.data?.login}`
                        : "not connected"}
                  </Text>
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                {connected ? (
                  <PrimaryButton
                    label="Disconnect"
                    variant="outline"
                    onPress={() => disconnectMut.mutate()}
                    loading={disconnectMut.isPending}
                  />
                ) : (
                  <PrimaryButton
                    label="Connect GitHub"
                    onPress={() => connectMut.mutate()}
                    loading={connectMut.isPending}
                  />
                )}
              </View>
            </Card>

            {connected && summary && (
              <Card>
                <Text style={styles.sectionLabel}>// portfolio preview</Text>
                <View style={styles.statsGrid}>
                  <StatTile icon="package" label="Active repos" value={summary.totalRepos} colors={colors} />
                  <StatTile icon="star" label="Total stars" value={summary.totalStars} colors={colors} />
                  <StatTile icon="clock" label="Dormant (6mo+)" value={summary.dormantCount} colors={colors} />
                  <StatTile icon="trending-up" label="Avg size" value={`${summary.avgSizeKb}KB`} colors={colors} />
                </View>
                {summary.topLanguages.length > 0 && (
                  <View style={styles.badgeRow}>
                    {summary.topLanguages.map((lang) => (
                      <Badge key={lang.name} label={`${lang.name} · ${lang.pct}%`} />
                    ))}
                  </View>
                )}
              </Card>
            )}

            <Card>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    Run new analysis
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                    {connected
                      ? "Deep-sample up to 25 repos and get AI recommendations"
                      : "Connect GitHub first"}
                  </Text>
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <PrimaryButton
                  label="Run analysis"
                  onPress={() => runMut.mutate()}
                  loading={runMut.isPending}
                  disabled={!connected}
                />
              </View>
              {runMut.isPending && (
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8 }}>
                  fetching repos → sampling code → asking the AI (this can take 30–90s)…
                </Text>
              )}
            </Card>

            <Text style={styles.sectionLabel}>// past analyses</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/analysis/${item.id as string}`)}>
            <Card style={{ marginTop: 8 }}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                    analysis_{(item.id as string).slice(0, 8)}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>
                    {item.repo_count as number} repos · {item.status as string}
                  </Text>
                </View>
                <Pressable onPress={() => deleteMut.mutate(item.id as string)}>
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={
          analysesQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
          ) : (
            <Card style={{ marginTop: 8 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center" }}>
                No analyses yet. Run your first analysis above.
              </Text>
            </Card>
          )
        }
      />
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string | number;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.statTile}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Feather name={icon} size={12} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{label}</Text>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16, marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 24, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionLabel: { color: "#9199a5", fontSize: 12, fontFamily: "Inter_500Medium" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 12 },
  statTile: { width: "45%" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
});
