import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { GitBranch, LayoutDashboard, Menu, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface HeaderUser {
  login?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

interface AppHeaderProps {
  section?: string;
  user?: HeaderUser | null;
  actions?: ReactNode;
}

export function AppHeader({ section, user, actions }: AppHeaderProps) {
  const userLabel = user?.displayName || user?.login || null;

  return (
    <header className="sticky top-0 z-[100] border-b border-border bg-background text-foreground shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2 rounded-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <GitBranch className="h-6 w-6 shrink-0 text-primary" />
            <span className="truncate text-base font-bold text-foreground sm:text-lg">RepoFinisher</span>
          </Link>

          {section && (
            <>
              <div className="hidden h-6 w-px bg-border sm:block" />
              <span className="hidden truncate text-sm font-medium text-muted-foreground sm:block">{section}</span>
            </>
          )}

          {userLabel && (
            <div className="ml-2 hidden min-w-0 items-center gap-2 text-sm text-muted-foreground md:flex">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.login || userLabel} className="h-6 w-6 shrink-0 rounded-full" />
              ) : null}
              <span className="max-w-48 truncate">{userLabel}</span>
            </div>
          )}
        </div>

        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}

        <nav className="hidden shrink-0 items-center gap-1 text-foreground sm:flex" aria-label="Primary navigation">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2 text-foreground">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="gap-2 text-foreground">
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          </Link>
        </nav>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 border-border bg-card text-foreground shadow-sm sm:hidden"
              aria-label="Open navigation menu"
              data-testid="button-mobile-menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="z-[250] w-64 border-border bg-popover text-popover-foreground shadow-xl"
          >
            <DropdownMenuLabel className="truncate">{section || 'RepoFinisher'}</DropdownMenuLabel>
            {userLabel ? (
              <div className="px-2 pb-2 text-xs text-muted-foreground">
                <div className="truncate">{userLabel}</div>
                {user?.login && user.login !== userLabel ? <div className="truncate">@{user.login}</div> : null}
              </div>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard" className="flex w-full cursor-pointer items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex w-full cursor-pointer items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
