import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { Badge, Card, PrimaryButton } from "@/components/UI";
import {
  assessMarketAndValue,
  combineRepos,
  generateVibeSpec,
  getAnalysis,
  getRepoHealth,
  toggleShare,
} from "@/lib/api-client";

const KIND_COLOR: Record<string, "ship" | "combine" | "repurpose"> = {
  finish: "ship",
  combine: "combine",
  repurpose: "repurpose",
};

export default function AnalysisDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { ready } = useProtectedRoute();
  const queryClient = useQueryClient();
  const [toolOutput, setToolOutput] = useState<Record<number, string>>({});
  const [activeItem, setActiveItem] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ["analysis", id],
    queryFn: () => getAnalysis(id),
    enabled: ready && !!id,
  });

  const shareMut = useMutation({
    mutationFn: (isPublic: boolean) => toggleShare(id, isPublic),
    onSuccess: () => query.refetch(),
  });

  const marketMut = useMutation({
    mutationFn: (rank: number) => assessMarketAndValue(id, rank),
    onMutate: (rank) => setActiveItem(rank),
    onSuccess: (res, rank) => {
      setToolOutput((prev) => ({ ...prev, [rank]: JSON.stringify(res, null, 2) }));
    },
    onSettled: () => setActiveItem(null),
  });

  const vibeSpecMut = useMutation({
    mutationFn: (rank: number) => generateVibeSpec(id, rank),
    onMutate: (rank) => setActiveItem(rank),
    onSuccess: (res, rank) => {
      setToolOutput((prev) => ({ ...prev, [rank]: JSON.stringify(res, null, 2) }));
    },
    onSettled: () => setActiveItem(null),
  });

  const combineMut = useMutation({
    mutationFn: (rank: number) => combineRepos(id, rank),
    onMutate: (rank) => setActiveItem(rank),
    onSuccess: (res, rank) => {
      setToolOutput((prev) => ({ ...prev, [rank]: JSON.stringify(res, null, 2) }));
    },
    onSettled: () => setActiveItem(null),
  });

  const healthMut = useMutation({
    mutationFn: (repo: string) => getRepoHealth(repo),
  });

  if (!ready || query.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (query.isError || !query.data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 20 }]}>
        <Text style={{ color: colors.destructive }}>Couldn't load this analysis.</Text>
      </View>
    );
  }

  const analysis = query.data.analysis as Record<string, unknown>;
  const items = query.data.items as Record<string, unknown>[];

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
            Analysis results
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
            {items.length} recommendations · {(analysis.status as string) ?? "complete"}
          </Text>
        </View>
        <PrimaryButton
          label={analysis.is_public ? "Unshare" : "Share"}
          variant="outline"
          onPress={() => shareMut.mutate(!analysis.is_public)}
          loading={shareMut.isPending}
        />
      </View>

      <View style={{ gap: 12, marginTop: 16 }}>
        {items.map((item) => {
          const rank = item.rank as number;
          const kind = (item.kind as string) ?? "finish";
          const repo = (item.repo as string) ?? (item.repos as string[])?.[0] ?? "";
          const isBusy = activeItem === rank && (marketMut.isPending || vibeSpecMut.isPending || combineMut.isPending);

          return (
            <Card key={rank}>
              <View style={styles.itemHeader}>
                <Badge label={kind.toUpperCase()} />
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>#{rank}</Text>
              </View>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, marginTop: 8 }}>
                {(item.title as string) ?? repo}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
                {(item.rationale as string) ?? (item.description as string) ?? ""}
              </Text>

              <View style={styles.actionRow}>
                {kind === "finish" && repo && (
                  <PrimaryButton
                    label="Check health"
                    variant="outline"
                    onPress={() => healthMut.mutate(repo)}
                    loading={healthMut.isPending}
                  />
                )}
                {kind === "combine" && (
                  <PrimaryButton
                    label="Combine plan"
                    variant="outline"
                    onPress={() => combineMut.mutate(rank)}
                    loading={isBusy}
                  />
                )}
                {kind === "repurpose" && (
                  <PrimaryButton
                    label="Vibe spec"
                    variant="outline"
                    onPress={() => vibeSpecMut.mutate(rank)}
                    loading={isBusy}
                  />
                )}
                <PrimaryButton
                  label="Market value"
                  variant="ghost"
                  onPress={() => marketMut.mutate(rank)}
                  loading={isBusy}
                />
              </View>

              {healthMut.data && healthMut.variables === repo && (
                <View style={[styles.output, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                    Health: {healthMut.data.healthScore}/100 ({healthMut.data.grade})
                  </Text>
                </View>
              )}

              {toolOutput[rank] && (
                <View style={[styles.output, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground, fontSize: 11, fontFamily: "Inter_400Regular" }}>
                    {toolOutput[rank].slice(0, 600)}
                  </Text>
                </View>
              )}
            </Card>
          );
        })}

        {items.length === 0 && (
          <Card>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center" }}>
              No recommendations were generated for this analysis.
            </Text>
          </Card>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  output: { marginTop: 12, borderTopWidth: 1, paddingTop: 10 },
});
