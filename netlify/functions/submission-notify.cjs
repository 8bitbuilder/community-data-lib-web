/**
 * Netlify Function: submission-notify
 *
 * Triggered automatically by Netlify when a form submission named
 * "resource-submission" is received (via the netlify:submission-created
 * event hook configured in netlify.toml).
 *
 * What it does:
 * 1. Receives the form payload from Netlify Forms.
 * 2. Normalises the field values.
 * 3. (Optional) Posts a formatted notification to a Slack webhook URL
 *    stored in the SLACK_WEBHOOK_URL environment variable.
 * 4. Responds with 200 OK so Netlify marks the notification as delivered.
 *
 * Environment variables (set in Netlify dashboard > Site settings > Env vars):
 *   SLACK_WEBHOOK_URL  — Incoming Webhook URL for your #submissions channel.
 *                        Leave unset to skip Slack notification.
 *
 * How to set up Slack notifications:
 *   1. Go to https://api.slack.com/apps and create an app.
 *   2. Enable "Incoming Webhooks" and add it to your target channel.
 *   3. Copy the webhook URL and add it as SLACK_WEBHOOK_URL in Netlify.
 */

exports.handler = async function (event) {
  // Netlify sends the form payload as JSON in event.body
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON payload' };
  }

  const form = payload?.payload ?? payload;
  const data = form?.data ?? {};

  // Build a human-readable summary
  const title = data.title ?? '(no title)';
  const description = data.description ?? '(no description)';
  const url = data.url ?? '';
  const category = data.category ?? 'unknown';
  const difficulty = data.difficulty || 'not specified';
  const themes = data.data_themes || '';
  const tags = data.tags || '';
  const submitterName = data.submitter_name || 'Anonymous';
  const submitterRole = data.submitter_role || 'unknown role';
  const submitterEmail = data.submitter_email || '';
  const sensitive = data.sensitive === 'true' ? '⚠️ SENSITIVE' : '';
  const submittedAt = new Date().toISOString();

  console.log('New resource submission received:', {
    title,
    category,
    submitterName,
    submittedAt,
  });

  // Post to Slack if webhook URL is configured
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (slackUrl) {
    const slackBody = {
      text: `📚 *New CDL Resource Submission* ${sensitive}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `📚 New Resource: ${title}`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Category:*\n${category}` },
            { type: 'mrkdwn', text: `*Difficulty:*\n${difficulty}` },
            { type: 'mrkdwn', text: `*Themes:*\n${themes || 'none'}` },
            { type: 'mrkdwn', text: `*Tags:*\n${tags || 'none'}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Description:*\n${description}` },
        },
        url
          ? {
              type: 'section',
              text: { type: 'mrkdwn', text: `*URL:*\n<${url}|${url}>` },
            }
          : null,
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Submitted by *${submitterName}* (${submitterRole})${submitterEmail ? ` · ${submitterEmail}` : ''} · ${submittedAt}`,
            },
          ],
        },
        sensitive
          ? {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `⚠️ *Submitter flagged this as sensitive content* — review before publishing.`,
              },
            }
          : null,
        {
          type: 'divider',
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Submissions' },
              url: 'https://app.netlify.com/sites/community-data-libraries/forms/resource-submission',
              style: 'primary',
            },
          ],
        },
      ].filter(Boolean),
    };

    try {
      const res = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackBody),
      });
      if (!res.ok) {
        console.warn('Slack notification failed:', res.status, await res.text());
      } else {
        console.log('Slack notification sent.');
      }
    } catch (err) {
      console.error('Error posting to Slack:', err.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true, title }),
  };
};
