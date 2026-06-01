"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { DisplayNameFormState } from "./page";

type DisplayNameFormProps = {
  action: (state: DisplayNameFormState, formData: FormData) => Promise<DisplayNameFormState>;
  defaultValue: string;
};

const initialState: DisplayNameFormState = {
  message: null,
};

export function DisplayNameForm({ action, defaultValue }: DisplayNameFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const invalid = Boolean(state.message);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          key={state.value ?? defaultValue}
          id="displayName"
          name="displayName"
          aria-describedby={invalid ? "displayName-error" : undefined}
          aria-invalid={invalid}
          defaultValue={state.value ?? defaultValue}
        />
        {state.message ? (
          <p id="displayName-error" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={isPending}>
        Save display name
      </Button>
    </form>
  );
}
