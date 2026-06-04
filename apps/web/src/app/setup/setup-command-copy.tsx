"use client";

import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const SETUP_COMMAND = "npx @blnayan/token-burn@latest setup";

type ClipboardWriter = {
  writeText: (text: string) => Promise<void>;
};

type CopyStatus = "idle" | "copied" | "failed";

export async function copySetupCommand(
  clipboard: ClipboardWriter | undefined = navigator.clipboard,
): Promise<void> {
  if (!clipboard?.writeText) {
    throw new Error("Clipboard copy is unavailable");
  }

  await clipboard.writeText(SETUP_COMMAND);
}

export function SetupCommandCopy() {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function handleCopy() {
    try {
      await copySetupCommand();
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="setupCommand">CLI setup command</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="setupCommand" value={SETUP_COMMAND} readOnly className="font-mono text-sm" />
        <Button type="button" onClick={handleCopy} className="sm:w-24">
          {status === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {status === "copied" ? "Setup command copied." : null}
        {status === "failed" ? "Could not copy command. Select it manually." : null}
      </p>
    </div>
  );
}
