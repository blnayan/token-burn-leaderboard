"use client";

import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ClipboardWriter = {
  writeText: (text: string) => Promise<void>;
};

type CopyStatus = "idle" | "copied" | "failed";

export async function copyInviteUrl(
  inviteUrl: string,
  clipboard: ClipboardWriter | undefined = navigator.clipboard,
): Promise<void> {
  if (!clipboard?.writeText) {
    throw new Error("Clipboard copy is unavailable");
  }

  await clipboard.writeText(inviteUrl);
}

export function InviteUrlCopy({ inviteUrl }: { inviteUrl: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function handleCopy() {
    try {
      await copyInviteUrl(inviteUrl);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="inviteUrl">Invite URL</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="inviteUrl" value={inviteUrl} readOnly className="font-mono text-sm" />
        <Button type="button" onClick={handleCopy} className="sm:w-24">
          {status === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {status === "copied" ? "Invite link copied." : null}
        {status === "failed" ? "Could not copy invite link. Select the URL manually." : null}
      </p>
    </div>
  );
}
