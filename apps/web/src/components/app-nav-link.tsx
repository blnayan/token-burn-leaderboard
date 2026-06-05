"use client"
/** @jsxRuntime automatic */

import Link from "next/link";

import {
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/utils";

type AppNavLinkProps = {
  href: string;
  currentPath?: string;
  children: string;
};

export function AppNavLink({ href, currentPath, children }: AppNavLinkProps) {
  const isCurrent = currentPath === href;

  return (
    <NavigationMenuItem>
      <NavigationMenuLink
        asChild
        className={cn(
          navigationMenuTriggerStyle(),
          "h-8 px-2 text-sm font-medium text-muted-foreground hover:bg-transparent hover:text-foreground focus:bg-transparent focus:text-foreground data-[state=open]:bg-transparent",
          isCurrent && "text-foreground",
        )}
        aria-current={isCurrent ? "page" : undefined}
      >
        <Link href={href}>{children}</Link>
      </NavigationMenuLink>
    </NavigationMenuItem>
  );
}
