export async function sendMagicLink({ apiKey, from, to, link, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your Community Data Libraries editor sign-in link',
      text: `Use this link to sign in and edit dataset metadata:\n\n${link}\n\nIt expires in 15 minutes and works once. If you did not request it, you can ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded with HTTP ${res.status}`);
}
