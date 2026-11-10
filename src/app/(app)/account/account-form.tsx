"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";
import { useAction } from "@/hooks/use-action";
import { updatePassword, updateProfile } from "@/lib/actions/auth";

export function AccountForm({ name }: { name: string }) {
  const { pending, run } = useAction();
  const [fullName, setFullName] = useState(name);
  const [password, setPassword] = useState("");
  return (
    <div className="grid max-w-3xl gap-6 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent>
          <Field label="Full name" htmlFor="acc-name"><Input id="acc-name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        </CardContent>
        <CardFooter className="justify-end border-t"><Button disabled={pending} onClick={() => run(() => updateProfile({ full_name: fullName }))}>Save</Button></CardFooter>
      </Card>
      <Card>
        <CardHeader><CardTitle>Password</CardTitle></CardHeader>
        <CardContent>
          <Field label="New password" htmlFor="acc-pw" hint="At least 8 characters."><Input id="acc-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </CardContent>
        <CardFooter className="justify-end border-t"><Button disabled={pending || password.length < 8} onClick={() => run(() => updatePassword(password), { onSuccess: () => setPassword("") })}>Update password</Button></CardFooter>
      </Card>
    </div>
  );
}
