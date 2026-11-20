import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { signOut } from '@/lib/auth';
import { LayoutDashboard, LogOut, Menu, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
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
  onSignOut?: () => void;
}

export function AppHeader({ section, user, actions, onSignOut }: AppHeaderProps) {
  const [, setLocation] = useLocation();
  const userLabel = user?.displayName || user?.login || null;
  const signOutHandler = onSignOut ?? (() => {
    void signOut().then(() => setLocation('/auth'));
  });

  return (
    <header
      data-app-header
      className="sticky top-0 z-[100] border-b-[3px] border-foreground bg-background text-foreground"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-2 rounded-none text-foreground focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#9B5CFF] focus-visible:outline-offset-[3px]"
          >
            <span
              aria-hidden
              className="block h-6 w-6 shrink-0 rotate-[-8deg] border-[3px] border-foreground bg-primary shadow-[3px_3px_0_#9B5CFF]"
            />
            <span className="na-title truncate text-lg text-foreground sm:text-xl">{BRAND.name}</span>
          </Link>

          {section && (
            <>
              <div className="hidden h-6 w-px bg-foreground/30 lg:block" />
              <span className="hidden truncate text-sm font-bold uppercase tracking-[2px] text-muted-foreground lg:block">
                {section}
              </span>
            </>
          )}

          {userLabel && (
            <div className="ml-2 hidden min-w-0 items-center gap-2 text-sm text-muted-foreground lg:flex">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.login || userLabel}
                  className="h-6 w-6 shrink-0 rounded-full border-2 border-foreground bg-secondary object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}
              <span className="max-w-48 truncate">{userLabel}</span>
            </div>
          )}
        </div>

        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}

        <nav className="hidden shrink-0 items-center gap-1 text-foreground lg:flex" aria-label="Primary navigation">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2 text-foreground hover:bg-foreground/10 hover:text-foreground">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="gap-2 text-foreground hover:bg-foreground/10 hover:text-foreground">
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          </Link>
          <Button variant="ghost" size="sm" className="gap-2 text-foreground hover:bg-foreground/10 hover:text-foreground" onClick={signOutHandler}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </nav>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 lg:hidden"
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
            <DropdownMenuLabel className="truncate">{section || BRAND.name}</DropdownMenuLabel>
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
            <DropdownMenuItem onSelect={() => signOutHandler()} className="cursor-pointer gap-2">
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
