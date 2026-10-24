// 初代's messages (#/messages/<ID>) on the shared MessageBook: the files of every archive (messages.ts), with 初代's
// tags (HONOLULU_SYNTAX). The edits are kept in the session's store (saved and exported with the session).
import type { ReactNode } from 'react';
import { MessageBook } from '../ui/MessageBook';
import type { HonoluluSession } from './session';

export function HonoluluMessagePage({ session, arg }: { session: HonoluluSession; arg: string | undefined }): ReactNode {
  const { messages } = session;
  return (
    <MessageBook texts={messages.texts} files={messages.files} arg={arg} onEdit={() => session.edited()}
      placeholder="本文か ID (551、0x227) で検索"
      help={
        <>
          {'ルビは {ruby:親字|よみ}、改ページは {page}、別のメッセージの差し込みは {msg:XXXX} です。'}
          {'{tag:0101}〜{tag:0107} は電波人間・モンスター・アイテムなどの名前、{tag:0002}〜{tag:0011} は数値、'}
          {'先頭の {tag:010B}〜{tag:010D} は話し手の口調 (魔王・片言・です調) です。ほかのタグは意味が分かっていないので、そのまま残してください。'}
        </>
      } />
  );
}
