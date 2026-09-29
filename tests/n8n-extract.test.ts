import { describe, expect, it } from 'vitest';
import { registry } from '@/lib/registry';
import { extractFromExecution, senderNodesIn, type N8nExecution } from '@/lib/sync/n8n-extract';

const wf = (id: string) => registry().workflows.find((w) => w.id === id)!;

describe('n8n execution extraction', () => {
  it('reads SMTP sends (agency campaign) with message id and SMTP response', () => {
    const exec: N8nExecution = {
      id: '26000',
      workflowId: 'DXQsMGCz7F6Rfay0',
      status: 'success',
      startedAt: '2026-09-29T05:30:00.070Z',
      data: {
        resultData: {
          runData: {
            'Route By Mailbox': [{ data: { main: [[{ json: { email: 'owner@agency-one.example', subject: 'Hello', mailboxIndex: 0 } }], [], []] } }],
            'Send from agency@': [
              {
                startTime: 1790659801387,
                source: [{ previousNode: 'Route By Mailbox', previousNodeOutput: 0, previousNodeRun: 0 }],
                data: {
                  main: [
                    [{ json: { accepted: ['owner@agency-one.example'], rejected: [], response: '250 2.0.0 Ok: queued as ABC', messageId: '<m1@adssuspensionrecovery.com>' }, pairedItem: { item: 0 } }],
                    [],
                  ],
                },
              },
            ],
          },
        },
      },
    };
    const { attempts, warnings } = extractFromExecution(exec, wf('DXQsMGCz7F6Rfay0'));
    expect(warnings).toEqual([]);
    expect(attempts).toHaveLength(1);
    const a = attempts[0];
    expect(a.campaignSlug).toBe('agency-outreach-india');
    expect(a.result).toBe('accepted');
    expect(a.sender).toBe('agency@adssuspensionrecovery.com');
    expect(a.recipient).toBe('owner@agency-one.example');
    expect(a.messageId).toBe('<m1@adssuspensionrecovery.com>');
    expect(a.providerStatus).toMatch(/^250/);
    expect(a.step).toBe(0);
    expect(a.occurredAt?.toISOString()).toBe(new Date(1790659801387).toISOString());
    expect(a.idempotencyKey).toBe('n8n:26000:Send from agency@:0:0:0');
  });

  it('routes Hostinger dispatcher rows to campaigns by LeadID and records error-output failures', () => {
    const loop = { previousNode: 'Loop Leads', previousNodeOutput: 1 };
    const exec: N8nExecution = {
      id: '100',
      workflowId: 'NJLi3kOJRaoB5Bu7',
      status: 'success',
      data: {
        resultData: {
          runData: {
            'Loop Leads': [
              { data: { main: [[], [{ json: { LeadID: 'uk-gads-plumber-1', Email: 'a@plumber.example', 'Send-from mailbox': 'ads@rohitkumarseo.tech', Subject: 'S1' } }]] } },
              { data: { main: [[], [{ json: { LeadID: 'seo-bakery', Email: 'b@bakery.example', 'Send-from mailbox': 'rohit@rohitkumarseo.tech', Subject: 'S2' } }]] } },
            ],
            'Send via Hostinger': [
              { startTime: 1000, source: [{ ...loop, previousNodeRun: 0 }], data: { main: [[{ json: {}, pairedItem: { item: 0 } }], []] } },
              { startTime: 2000, source: [{ ...loop, previousNodeRun: 1 }], data: { main: [[], [{ json: { error: { message: 'Forbidden - perhaps check your credentials?' } }, pairedItem: { item: 0 } }]] } },
            ],
          },
        },
      },
    };
    const { attempts } = extractFromExecution(exec, wf('NJLi3kOJRaoB5Bu7'));
    expect(attempts.map((a) => [a.campaignSlug, a.result, a.sender, a.leadRowKey])).toEqual([
      ['google-ads-services-intl', 'accepted', 'ads@rohitkumarseo.tech', 'uk-gads-plumber-1'],
      ['seo-visibility-us', 'failed', 'rohit@rohitkumarseo.tech', 'seo-bakery'],
    ]);
    expect(attempts[1].errorMessage).toContain('Forbidden');
  });

  it('treats Hostinger error bodies returned with neverError as failures, and maps TouchNumber to the follow-up step', () => {
    const exec: N8nExecution = {
      id: '200',
      workflowId: 'whdGAfYsvLEGCTKy',
      data: {
        resultData: {
          runData: {
            'Route To Mailbox': [
              {
                data: {
                  main: [
                    [
                      { json: { LeadID: 'SAO-a', Email: 'x@a.example', Subject: 'hi', TouchNumber: 1 } },
                      { json: { LeadID: 'SAO-b', Email: 'y@b.example', Subject: 'bump', TouchNumber: 3 } },
                    ],
                    [],
                  ],
                },
              },
            ],
            'Send via Hostinger (info@)': [
              {
                startTime: 5,
                source: [{ previousNode: 'Route To Mailbox', previousNodeOutput: 0, previousNodeRun: 0 }],
                data: { main: [[{ json: {}, pairedItem: { item: 0 } }, { json: { code: 'ERR_FORBIDDEN', error: 'Forbidden.' }, pairedItem: { item: 1 } }]] },
              },
            ],
          },
        },
      },
    };
    const { attempts } = extractFromExecution(exec, wf('whdGAfYsvLEGCTKy'));
    expect(attempts.map((a) => [a.result, a.step, a.sender])).toEqual([
      ['accepted', 0, 'info@rohitkumarseo.tech'],
      ['failed', 2, 'info@rohitkumarseo.tech'],
    ]);
  });

  it('reads follow-up step from the RKD engine nextStatus and WAHA message keys', () => {
    const fu = extractFromExecution(
      {
        id: '300',
        workflowId: 'cpwJqG7Zoe5yQfPq',
        data: {
          resultData: {
            runData: {
              'Route by Sender': [{ data: { main: [[], [{ json: { toEmail: 'c@clinic.example', subject: 'One more thought', senderEmail: 'jacob@rkdigitalmedia.in', nextStatus: 'FU2 Sent' } }]] } }],
              'Send from Jacob': [
                {
                  startTime: 9,
                  source: [{ previousNode: 'Route by Sender', previousNodeOutput: 1, previousNodeRun: 0 }],
                  data: { main: [[{ json: { accepted: ['c@clinic.example'], rejected: [], response: '250 OK', messageId: '<x@rk>' }, pairedItem: { item: 0 } }]] },
                },
              ],
            },
          },
        },
      },
      wf('cpwJqG7Zoe5yQfPq'),
    );
    expect(fu.attempts[0]).toMatchObject({ campaignSlug: 'aesthetic-clinics-rkd', step: 2, result: 'accepted', sender: 'jacob@rkdigitalmedia.in' });

    const wa = extractFromExecution(
      {
        id: '400',
        workflowId: 'GPhJ2BoS8BaIP3JU',
        data: {
          resultData: {
            runData: {
              'Wait (pacing)': [
                { data: { main: [[{ json: { chatId: '971500000001@c.us', session: 'dubai_car_recovery', businessName: 'Tow A' } }]] } },
                { data: { main: [[{ json: { chatId: '971500000002@c.us', session: 'dubai_car_recovery', businessName: 'Tow B' } }]] } },
              ],
              'Send via WAHA': [
                { startTime: 1, source: [{ previousNode: 'Wait (pacing)', previousNodeRun: 0 }], data: { main: [[{ json: { key: { id: '3EB0AAA', fromMe: true } }, pairedItem: { item: 0 } }]] } },
                { startTime: 2, source: [{ previousNode: 'Wait (pacing)', previousNodeRun: 1 }], data: { main: [[{ json: { statusCode: 500, message: 'session not ready' }, pairedItem: { item: 0 } }]] } },
              ],
            },
          },
        },
      },
      wf('GPhJ2BoS8BaIP3JU'),
    );
    expect(wa.attempts.map((a) => [a.channel, a.recipient, a.result, a.messageId, a.sender])).toEqual([
      ['whatsapp', '971500000001@c.us', 'accepted', '3EB0AAA', 'dubai_car_recovery'],
      ['whatsapp', '971500000002@c.us', 'failed', null, 'dubai_car_recovery'],
    ]);
  });

  it('marks every input item unknown when a send node fails as a whole', () => {
    const { attempts, warnings } = extractFromExecution(
      {
        id: '500',
        workflowId: 'sUMZ8H5bkSyFPWZm',
        data: {
          resultData: {
            runData: {
              'Build Followup Email': [{ data: { main: [[{ json: { email: 'p@site.example', stage: 1, email_subject: 'nudge' } }, { json: { email: 'q@site.example', stage: 0 } }]] } }],
              'Send Followup Email': [{ startTime: 3, error: { message: 'Invalid login: 535 Authentication failed' }, source: [{ previousNode: 'Build Followup Email' }] }],
            },
          },
        },
      },
      wf('sUMZ8H5bkSyFPWZm'),
    );
    expect(attempts.map((a) => [a.recipient, a.result, a.step])).toEqual([
      ['p@site.example', 'unknown', 2],
      ['q@site.example', 'unknown', 1],
    ]);
    expect(warnings[0]).toContain('per-item outcome unknown');
  });

  it('produces identical idempotency keys when the same execution is processed twice', () => {
    const exec: N8nExecution = {
      id: '600',
      workflowId: 'Bj8UfTYGvzvSfsuX',
      data: {
        resultData: {
          runData: {
            'Map Mailbox Resource ID': [{ data: { main: [[{ json: { Email: 'r@realty.example', 'Send-from mailbox': 'hello@rohitkumarseo.tech', Subject: 'x' } }]] } }],
            'Send via Hostinger': [{ startTime: 7, source: [{ previousNode: 'Map Mailbox Resource ID' }], data: { main: [[{ json: {}, pairedItem: { item: 0 } }], []] } }],
          },
        },
      },
    };
    const k1 = extractFromExecution(exec, wf('Bj8UfTYGvzvSfsuX')).attempts.map((a) => a.idempotencyKey);
    const k2 = extractFromExecution(structuredClone(exec), wf('Bj8UfTYGvzvSfsuX')).attempts.map((a) => a.idempotencyKey);
    expect(k1).toEqual(k2);
    expect(k1).toHaveLength(1);
  });

  it('flags sender nodes for the untracked-workflow scan', () => {
    expect(
      senderNodesIn([
        { name: 'SMTP', type: 'n8n-nodes-base.emailSend' },
        { name: 'Hostinger', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://api.mail.hostinger.com/api/v1/mailboxes/AC1/send' } },
        { name: 'WAHA', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://waha.example/api/sendImage' } },
        { name: 'Other', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://example.com/api/list' } },
        { name: 'Off', type: 'n8n-nodes-base.emailSend', disabled: true },
      ]),
    ).toEqual(['SMTP', 'Hostinger', 'WAHA']);
  });
});
