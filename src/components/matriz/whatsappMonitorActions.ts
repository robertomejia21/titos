"use server";

import { sendMessage as greenSend } from "@/lib/greenApi";

export async function sendMessage(phone: string, message: string) {
  await greenSend(phone, message);
  return { ok: true };
}
