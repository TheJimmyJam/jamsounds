// The one sign-in code email (Jimmy, 2026-09-29): "all the codes for any app
// should be the 6 digit CCC model from CCC not from June." Every app's code
// mail is CannonCodeConnect's dark email: the CCC logo, the code in its own
// box, the app named in the line under it, a button for browsers. Sent as
// CannonCodeConnect with the same subject everywhere.
//
// The master copy is CCC's Supabase magic-link template (project
// azkyohtmhlvnkziuvgvk). This file is copied into each app that mails its own
// codes; change one, change them all.
"use strict";

// jimmy@ is measured, not preferred: only jimmy@ and hello@ land in the inbox
// from cannoncodeconnect.com (A/B proven 2026-09-22). The sender's display
// name is what anyone reads. Deliberately NOT the app's *_MAIL_FROM env:
// that one stays for the app's other mail.
const CODE_FROM = "CannonCodeConnect <jimmy@cannoncodeconnect.com>";
const codeSubject = (code) => `${code} is your CannonCodeConnect sign-in code`;
const LOGO = "https://cannoncodeconnect.com/CCC_Logos/CCC_logo_email.png";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * code, link (for browsers), app ("JamCut"), minutes the code lasts.
 * heading/lead: an invitation's opening words (JamTravel); a plain sign-in
 * leaves them out. host: the origin the code is typed into, for Apple's
 * origin-bound "@host #code" line.
 */
function codeMail({ code, link, app, minutes = 60, heading = "", lead = "", host = "" }) {
  const a = esc(app);
  const l = esc(link);
  const mins = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body bgcolor="#0f1117" style="margin:0;padding:0;background-color:#0f1117 !important;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#0f1117" style="background-color:#0f1117;padding:40px 20px">
    <tr><td align="center" bgcolor="#0f1117">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
  <tr><td align="center" style="padding-bottom:24px" bgcolor="#0f1117">
    <img src="${LOGO}" width="220" alt="CannonCodeConnect" style="display:block;width:220px;height:auto;border-radius:10px" border="0">
  </td></tr>
        <tr><td bgcolor="#1a1d27" style="background-color:#1a1d27;border:1px solid #2a2d3a;border-radius:14px;overflow:hidden">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td bgcolor="#00cfff" height="3" style="background:linear-gradient(90deg,#00cfff,#7c3aed);height:3px;font-size:0;line-height:0">&nbsp;</td></tr>
            <tr><td bgcolor="#1a1d27" style="background-color:#1a1d27;padding:36px 40px 32px">
              ${heading ? `<p style="margin:0 0 8px;font-size:20px;color:#ffffff;font-weight:700">${esc(heading)}</p>` : ""}
              ${lead ? `<p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6">${esc(lead)}</p>` : ""}
              <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;font-weight:600">Your sign-in code</p>
              <div style="margin:0 0 20px;padding:16px 0;background-color:#0f1117;border:1px solid #2a2d3a;border-radius:8px;text-align:center;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#ffffff">${esc(code)}</div>
              <p style="margin:0 0 28px;font-size:15px;color:#9ca3af;line-height:1.6">Type it into ${a} on the device you want to be signed in on, including the installed app. It works once and expires in <strong style="color:#ffffff">${mins}</strong>. No password needed.</p>
              <p style="margin:0 0 12px;font-size:13px;color:#9ca3af">Signing in from a browser tab on this device? You can use the button instead:</p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px">
                <tr><td bgcolor="#00cfff" style="background:linear-gradient(135deg,#00cfff,#7c3aed);border-radius:8px">
                  <a href="${l}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px">Open ${a} →</a>
                </td></tr>
              </table>
              <div style="height:1px;background-color:#2a2d3a;margin-bottom:24px"></div>
              <p style="margin:0 0 6px;font-size:12px;color:#6b7280">Button not working? Copy and paste this link:</p>
              <p style="margin:0;font-size:11px;color:#00cfff;word-break:break-all;font-family:'Courier New',monospace">${l}</p>
            </td></tr>
            <tr><td bgcolor="#13151f" style="background-color:#13151f;padding:16px 40px;border-top:1px solid #2a2d3a">
              <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.6">🔒 If you didn't request this, you can safely ignore this email.</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" bgcolor="#0f1117" style="padding-top:24px">
          <p style="margin:0;font-size:12px;color:#374151"><strong style="color:#6b7280">CannonCodeConnect</strong> · Built by Jimmy Cannon</p>
          <p style="margin:4px 0 0;font-size:11px;color:#374151">Data. AI. Built for you.</p>
          ${host ? `<!-- Apple's origin-bound one-time code line: best effort in Mail, not a promise. -->
          <p style="margin:12px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#374151">@${esc(host)} #${esc(code)}</p>` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

module.exports = { CODE_FROM, codeSubject, codeMail, esc };
