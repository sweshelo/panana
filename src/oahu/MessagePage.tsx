// RPG3's messages (#/messages/<ID>) on the shared MessageBook. Edits are kept by ID (saved on this device) and
// exported with the Update's files.
import type { ReactNode } from 'react';
import { MessageBook, messageHref, parseMessageArg } from '../ui/MessageBook';
import type { OahuSession } from './session';

export const oahuMessageHref = messageHref;
export { parseMessageArg };

export function OahuMessagePage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const { messages } = session;
  return (
    <MessageBook texts={messages.texts} files={messages.files} arg={arg} onEdit={() => session.scheduleSave()}
      placeholder="本文か ID (40000、0x9C40) で検索"
      help={'ルビは {ruby:親字|よみ}、改ページは {page} です。ほかのタグはまだ意味が分かっていないので、{tag:XXXX} のまま残してください。'} />
  );
}
