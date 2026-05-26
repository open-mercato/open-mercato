"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@open-mercato/ui/primitives/button";
import { ErrorMessage } from "./ErrorMessage";
import { cn } from "@open-mercato/shared/lib/utils";
import { useT } from "@open-mercato/shared/lib/i18n/context";

export type RecordNotFoundStateProps = {
  label: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
  className?: string;
};

export function RecordNotFoundState({
  label,
  description,
  backHref,
  backLabel,
  action,
  className,
}: RecordNotFoundStateProps) {
  const t = useT();
  const defaultAction = backHref ? (
    <Button asChild variant="outline" size="sm">
      <Link href={backHref}>{backLabel ?? t('ui.recordNotFound.backToList','Back to list')}</Link>
    </Button>
  ) : null;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center min-h-[50vh] px-4",
        className,
      )}
    >
      <ErrorMessage
        label={label}
        description={description}
        action={action ?? defaultAction}
      />
    </div>
  );
}
