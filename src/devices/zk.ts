// ZKTeco "ADMS" cloud push (fingerprint / face attendance machines, also sold as Solution, Magic, Revo …). The machine calls
// http(s)://<server>/iclock/cdata, …/getrequest and …/devicecmd with ?SN=<serial>; the routes in app/iclock answer it.
export interface Scan { pin: string; time: string; status: string; verify: string }

/** ATTLOG body: one scan per line, tab-separated: user ID, "YYYY-MM-DD HH:MM:SS" (machine clock), status, verify mode, … */
export const parseAttlog = (body: string): Scan[] => body.split(/\r?\n/).map(l => l.split('\t')).filter(f => f[0]?.trim() && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(f[1] ?? ''))
  .map(([pin, time, status = '0', verify = '']) => ({ pin: pin.trim(), time, status: status.trim(), verify: verify.trim() }));

/** First call of the day: tells the machine to push every scan right away (Realtime=1), to resend what it has not sent,
 *  and its time zone (machines that set their clock from the server's GMT time would otherwise stamp scans in theirs). */
export const options = (sn: string, tz = '+07:00') => [`GET OPTION FROM: ${sn}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=None', 'ErrorDelay=30', 'Delay=10',
  'TransTimes=00:00;14:05', 'TransInterval=1', 'TransFlag=TransData AttLog', 'Realtime=1', 'Encrypt=None', `TimeZone=${Number(tz.slice(0, 3)) || 7}`].join('\n');
/** The address a machine calls from (nginx sets X-Forwarded-For to the caller), for the outlet's pinned address. */
export const callerIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null;
