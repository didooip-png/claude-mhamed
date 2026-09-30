import type { Permission } from '@pharmastock/shared';
import { ShieldAlert } from 'lucide-react';
import type * as React from 'react';
import { EmptyState } from '@/components/page';
import { useMe } from '@/lib/auth';

/** Masque un écran sans la permission requise (le serveur refuse de toute façon : 403). */
export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: Permission[];
  children: React.ReactNode;
}) {
  const me = useMe();
  if (!anyOf.some((p) => me.permissions.includes(p))) {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        title="Accès refusé"
        description="Vous n’avez pas la permission d’accéder à cet écran."
      />
    );
  }
  return <>{children}</>;
}
