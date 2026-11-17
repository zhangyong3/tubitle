import { Link } from '@tanstack/react-router';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/** Avatar + name + email for admin tables; links to the user's detail page (new tab by default). */
export function UserCell({
  userId,
  name,
  email,
  image,
  newTab = true,
}: {
  userId: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  newTab?: boolean;
}) {
  return (
    <Link
      to="/admin/users/$id"
      params={{ id: userId }}
      {...(newTab && { target: '_blank', rel: 'noopener noreferrer' })}
      className="flex min-w-0 items-center gap-3 rounded-md hover:opacity-80"
    >
      <Avatar className="size-8">
        <AvatarImage src={image || undefined} />
        <AvatarFallback className="text-xs">
          {(name || email || '?').charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{name || '—'}</span>
        <span className="text-muted-foreground truncate text-xs">
          {email || userId}
        </span>
      </div>
    </Link>
  );
}
