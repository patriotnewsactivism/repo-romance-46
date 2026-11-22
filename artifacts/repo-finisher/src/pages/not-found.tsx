import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Home } from 'lucide-react';
import { BRAND } from '@/lib/brand';

export default function NotFound() {
  return (
    <div className="dark relative flex min-h-screen items-center justify-center bg-background p-4 font-mono text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(135deg, transparent 0 22px, rgba(155, 92, 255, 0.08) 22px 24px)',
        }}
      />

      <Card className="relative w-full max-w-md text-center shadow-[10px_10px_0_#9B5CFF]">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <span
              aria-hidden
              className="block h-12 w-12 rotate-[-8deg] border-[3px] border-foreground bg-secondary shadow-[4px_4px_0_#FF4D2E]"
            />
          </div>
          <CardTitle className="text-3xl">404 — Not Found</CardTitle>
          <CardDescription className="text-base">
            The page you're looking for doesn't exist or has been moved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/">
            <Button className="w-full" data-testid="button-home">
              <Home className="mr-2 h-4 w-4" />
              Back to {BRAND.name}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
