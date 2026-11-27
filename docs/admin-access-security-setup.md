# Admin access security setup

This feature is implemented on the `feature/admin-access-security` branch. It is not enabled in production until the branch is reviewed, merged, and deliberately deployed.

## Email delivery

The invitation sender uses Resend. Configure these values in the deployment environment, not in Git:

```env
APP_BASE_URL=https://reputetechs.in
RESEND_FROM="Repute Tech Admin <admin@reputetechs.in>"
RESEND_REPLY_TO=reputetechs@gmail.com
RESEND_API_KEY=<store securely in the deployment secret manager>
```

Before enabling invitations:
1. Add `reputetechs.in` (or a dedicated sending subdomain) to the Resend account.
2. Copy the exact DNS records Resend generates into the authoritative DNS provider.
3. Wait until Resend reports the domain as verified.
4. Set the API key and environment values above in the deployment secret manager.
5. Send a test invitation to an account controlled by the platform owners.

The From address is `admin@reputetechs.in`; replies are directed to `reputetechs@gmail.com`. The invitee address is the email recipient. Do not put the API key in Git, source files, screenshots, or chat.

## Owner Super Admin bootstrap

The one-time script promotes exactly two existing accounts to Super Admin using their exact email addresses. It does not create accounts, replace passwords, change `User.role`, or alter business memberships.

Run only after both existing owner accounts have been verified in the database and after explicit production approval:

```env
ADMIN_SUPER_ADMIN_EMAILS=<owner-email-1>,<owner-email-2>
ADMIN_SUPER_ADMIN_BOOTSTRAP_CONFIRM=YES
```

Then run `npm run admin:bootstrap-super-admins` from a controlled environment with the intended production `DATABASE_URL`. The script stops before changing anything if either account is missing. Do not add this command to the normal application start or build process.

Both Super Admin accounts must complete authenticator-based 2FA before opening the Admin dashboard.

## Invitation lifecycle

- A Super Admin creates an invitation for a name and email.
- A cryptographically random, single-use token is emailed; only its HMAC digest is stored.
- Invitations expire after 24 hours.
- Resending revokes the previous pending link before creating a new one.
- Revocation makes a pending link unusable.
- Existing password-bearing accounts must be signed in as the invited account before acceptance; their password, owner role, and business memberships are preserved.
- Existing passwordless accounts may set a password while accepting; their account and memberships are preserved.
- New invitees receive an account with Owner role retained as the base account role plus a separate AdminAccess record.
- Newly invited Admins receive no payment permissions and must enroll in 2FA before Admin dashboard access.

Invitation tokens are placed in the URL fragment, not the query string, so they are not sent in the HTTP request URL or ordinary access logs.

## Permission model

Super Admins receive all permission keys. Ordinary Admins receive no payment permissions by default. Super Admins can grant only these delegated permissions:

- `PAYMENTS_VIEW`
- `PAYMENTS_CONFIGURE_UPI`
- `PAYMENTS_CONFIGURE_GATEWAY`
- `PAYMENTS_VERIFY`
- `PAYMENTS_APPROVE`
- `PAYMENTS_REFUND`
- `SUBSCRIPTIONS_ACTIVATE`
- `PAYMENTS_EXPORT`

`PAYMENT_PERMISSIONS_MANAGE` remains Super Admin-only. The existing subscription ledger, payment verification, refund, custom-plan pricing, plan pricing, and subscription activation routes enforce their corresponding permissions server-side. UPI and official gateway configuration permission keys are ready for the separate payment-settings integration; the current repository does not yet contain those provider configuration endpoints.

## Review and deployment checklist

- Review the draft pull request and wait for automated checks.
- Verify the Resend domain and environment configuration.
- Verify the exact two existing owner accounts before running the bootstrap script.
- Test invitation, expiry, resend, revocation, existing-owner acceptance, new-account acceptance, 2FA enrollment, permission grants, and permission denial in staging.
- Confirm the business-owner dashboard and memberships remain unchanged.
- Deploy only after explicit approval. No production database changes or deployment have been performed by this branch work.
