import { useRouter } from "expo-router";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";

export function TopBar({ title = "repo_finisher" }: { title?: string }) {
  const colors = useColors();
  const router = useRouter();
  const { session, signOut } = useAuth();

  return (
    <View
      style={[styles.wrap, { borderBottomColor: colors.border, backgroundColor: colors.card }]}
    >
      <Pressable style={styles.brand} onPress={() => router.push("/dashboard")}>
        <View style={[styles.dot, { backgroundColor: colors.primary }]} />
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
          {title}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable style={styles.iconBtn} onPress={() => router.push("/settings")}>
          <Feather name="settings" size={18} color={colors.mutedForeground} />
        </Pressable>
        {session && (
          <Pressable
            style={styles.iconBtn}
            onPress={async () => {
              await signOut();
              router.replace("/auth");
            }}
          >
            <Feather name="log-out" size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconBtn: {
    padding: 8,
  },
});
