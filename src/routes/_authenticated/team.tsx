import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Mail, Wrench, Megaphone, Activity, Lightbulb, Clock, ArrowLeft } from "lucide-react";
import { getEmployeeDashboard } from "@/lib/ai-employees.functions";

const ROLE_ICONS: Record<string, typeof Mail> = {
  support: Mail,
  engineering: Wrench,
  marketing: Megaphone,
  ops: Activity,
  product: Lightbulb,
  sales: Sparkles,
};

const ROLE_COLORS: Record<string, string> = {
  support: "bg-blue-500/10 text-blue-600",
  engineering: "bg-purple-500/10 text-purple-600",
  marketing: "bg-pink-500/10 text-pink-600",
  ops: "bg-green-500/10 text-green-600",
  product: "bg-orange-500/10 text-orange-600",
  sales: "bg-yellow-500/10 text-yellow-600",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  paused: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  off: "bg-gray-500/10 text-gray-600 border-gray-500/20",
};

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [{ title: "AI Team — RepoFinisher" }],
  }),
  component: AITeamPage,
});

function AITeamPage() {
  const dashboardFn = useServerFn(getEmployeeDashboard);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-team"],
    queryFn: () => dashboardFn(),
  });

  const employees = data?.employees ?? [];
  const recentLogs = data?.recentLogs ?? [];

  return (
    <div className="container mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AI Team</h1>
            <p className="text-muted-foreground mt-1">
              Your AI employees working 24/7 to run RepoFinisher
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-sm">
          {employees.filter((e: any) => e.status === "active").length} active
        </Badge>
      </div>

      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Loading team…
              </CardContent>
            </Card>
          ) : employees.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground mb-2">
                  No AI employees found in the database yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  Run the SQL migration in <code className="text-xs">supabase-migrations/ai_employees.sql</code> via the Supabase SQL Editor.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {employees.map((employee: any) => {
                const Icon = ROLE_ICONS[employee.role] || Sparkles;
                const colorClass = ROLE_COLORS[employee.role] || "";
                const statusClass = STATUS_COLORS[employee.status] || "";

                return (
                  <Card key={employee.id} className="relative overflow-hidden">
                    <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-lg">{employee.name}</CardTitle>
                        <p className="text-sm text-muted-foreground capitalize">{employee.role}</p>
                      </div>
                      <Badge variant="outline" className={`capitalize ${statusClass}`}>
                        {employee.status}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-3">
                        {employee.description || "No description set."}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          {employee.tasks_completed || 0} tasks completed
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {employee.tasks_today || 0} today
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity" className="space-y-3">
          {recentLogs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  No activity yet. Your AI team will log their work here as they complete tasks.
                </p>
              </CardContent>
            </Card>
          ) : (
            recentLogs.map((log: any) => (
              <Card key={log.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{log.employee_name}</span>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {log.task_type?.replace(/_/g, " ")}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-xs capitalize ${
                            log.status === "completed"
                              ? "border-green-500/20 text-green-600"
                              : log.status === "failed"
                                ? "border-red-500/20 text-red-600"
                                : ""
                          }`}
                        >
                          {log.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {log.summary || "No summary"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : ""}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
