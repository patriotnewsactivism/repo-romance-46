import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { Badge, Card } from "@/components/UI";
import { getPublicAnalysis } from "@/lib/api-client";

export default function SharedAnalysis() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const colors = useColors();

  const query = useQuery({
    queryKey: ["shared-analysis", slug],
    queryFn: () => getPublicAnalysis(slug),
    enabled: !!slug,
  });

  if (query.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (query.isError || !query.data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 20 }]}>
        <Text style={{ color: colors.destructive, textAlign: "center" }}>
          This shared analysis is not available.
        </Text>
      </View>
    );
  }

  const items = query.data.items as Record<string, unknown>[];

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={styles.brand}>
        <View style={[styles.dot, { backgroundColor: colors.primary }]} />
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
          repo_finisher
        </Text>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20, marginTop: 16 }}>
        Shared analysis
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
        {items.length} recommendations
      </Text>

      <View style={{ gap: 12, marginTop: 16 }}>
        {items.map((item) => (
          <Card key={item.rank as number}>
            <Badge label={((item.kind as string) ?? "finish").toUpperCase()} />
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, marginTop: 8 }}>
              {(item.title as string) ?? (item.repo as string)}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
              {(item.rationale as string) ?? (item.description as string) ?? ""}
            </Text>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
