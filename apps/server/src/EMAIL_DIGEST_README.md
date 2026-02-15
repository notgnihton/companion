# Email Digest Feature

The email digest feature provides a backup notification channel that sends daily or weekly summaries of important information to the user when push notifications fail or when the user has been inactive.

## Overview

This feature was implemented to ensure users stay informed even when:
- Push notifications fail to deliver (e.g., subscription expired, network issues)
- The user hasn't interacted with notifications recently (indicating they might have missed important updates)

## Components

### Core Files

- **`email-digest.ts`** - Main module containing digest generation, formatting, and sending logic
- **`email-digest.test.ts`** - Comprehensive test suite (23 tests)
- **Store integration** - Email digest configuration stored in SQLite database
- **Orchestrator integration** - Automatic checking and sending of digests

### Database Schema

New table `email_digest_config`:
- `enabled` - Whether digest is enabled
- `email` - Recipient email address
- `frequency` - "daily" or "weekly"
- `fallbackEnabled` - Whether to send fallback digests
- `fallbackThresholdHours` - Hours of inactivity before triggering fallback
- `lastSentAt` - Timestamp of last sent digest

## API Endpoints

### Get Configuration
```
GET /api/email-digest/config
```

### Update Configuration
```
PUT /api/email-digest/config
Body: {
  "enabled": true,
  "email": "user@example.com",
  "frequency": "daily",
  "fallbackEnabled": true,
  "fallbackThresholdHours": 24
}
```

### Manual Send
```
POST /api/email-digest/send
```

## Configuration

Set these environment variables in `.env`:

```bash
AXIS_SMTP_HOST=smtp.gmail.com
AXIS_SMTP_PORT=587
AXIS_SMTP_USER=your-email@gmail.com
AXIS_SMTP_PASSWORD=your-app-password
AXIS_SMTP_FROM=Companion <noreply@companion.app>
AXIS_DIGEST_EMAIL=recipient@example.com
```

### Gmail Setup

For Gmail, you need to:
1. Enable 2-factor authentication on your Google account
2. Generate an "App Password" at https://myaccount.google.com/apppasswords
3. Use the app password as `AXIS_SMTP_PASSWORD`

## Digest Types

### Daily Digest
Sent at 8am local time, includes:
- Upcoming deadlines (next 7 days)
- Today's class schedule
- Pending habits to complete
- Recent journal entries (last 3)

### Weekly Digest
Sent on Sunday at 8am, includes:
- Upcoming deadlines (next 14 days)
- Pending habits to complete
- Recent journal entries (last 3)
- Weekly statistics:
  - Deadlines completed
  - Journal entries written
  - Habits completed

## Fallback Logic

The orchestrator checks every 5 minutes whether to send a fallback digest:

### Push Failure Trigger
- Sends if 3+ push notification failures occurred within the threshold period
- Indicates "push notifications haven't been reaching you lately"

### User Inactivity Trigger
- Sends if no notification interactions (taps/dismisses) within threshold period
- Indicates "you haven't checked the app recently"

## Email Format

Each digest is sent in both HTML and plain text formats:

### HTML Version
- Responsive design suitable for mobile and desktop
- Color-coded priority levels for deadlines
- Structured sections with clear headings
- Alert box for fallback notifications

### Plain Text Version
- Clean ASCII formatting with separators
- Easy to read in any email client
- Same content as HTML version

## Functions

### Core Functions

**`generateDigestContent(store, frequency, fallbackReason?)`**
- Generates digest content structure from current store state
- Returns DigestContent object with all sections

**`formatDigestAsHTML(content)`**
- Converts DigestContent to styled HTML email
- Includes responsive CSS for mobile viewing

**`formatDigestAsText(content)`**
- Converts DigestContent to plain text format
- ASCII-friendly with clear section markers

**`sendEmailDigest(store, frequency, fallbackReason?)`**
- Sends email using configured SMTP settings
- Updates lastSentAt timestamp in store
- Returns success/error result

**`shouldSendScheduledDigest(store)`**
- Checks if scheduled digest is due
- Daily: sends at 8am if not already sent today
- Weekly: sends on Sunday at 8am if not sent this week

**`shouldSendFallbackDigest(store)`**
- Checks push failure count and user interaction history
- Returns whether to send and the reason (push_failures or user_inactive)

**`isEmailConfigured()`**
- Checks if all required SMTP environment variables are set
- Returns boolean

## Testing

Run the email digest tests:
```bash
npm test -- email-digest.test.ts
```

All 23 tests cover:
- Digest generation for daily and weekly frequencies
- HTML and text formatting
- Fallback trigger logic
- Scheduled digest timing
- Configuration persistence

## Security Considerations

- SMTP credentials stored in environment variables (never committed)
- Email addresses validated via Zod schema
- No user input directly embedded in emails (all content from database)
- Rate limiting through scheduled checks (5-minute intervals)

## Future Enhancements

Possible improvements:
- Allow customization of digest send time
- Support for multiple email recipients
- Email templates with user branding
- Click tracking for links in emails
- Unsubscribe link in email footer
- Rich notifications with images from journal photos
