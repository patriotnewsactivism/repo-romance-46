import React from 'react';
import { RepoHealthCheck } from '../src/components/RepoHealth';
import { Card, CardContent, CardHeader, CardTitle } from '../src/components/ui/card';

export default function RepoHealthExample() {
  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold">Repo Health Check Example</h1>
      <p className="text-muted-foreground">This example demonstrates how to use the `RepoHealthCheck` component to display the health status of a GitHub repository.</p>

      <Card>
        <CardHeader>
          <CardTitle>Example 1: Public Repo (initial closed state)</CardTitle>
        </CardHeader>
        <CardContent>
          <RepoHealthCheck repo="tanstack/router" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example 2: Another Public Repo (initial open state)</CardTitle>
        </CardHeader>
        <CardContent>
          <RepoHealthCheck repo="vercel/next.js" defaultOpen={true} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example 3: Non-existent Repo (will show error)</CardTitle>
        </CardHeader>
        <CardContent>
          <RepoHealthCheck repo="nonexistent-org/nonexistent-repo-123" defaultOpen={true} />
        </CardContent>
      </Card>
    </div>
  );
}
