import type { ReactNode } from 'react';
import { readBflim } from '../layout/bflim';
import { readSarc } from '../layout/sarc';
import { imageUrl } from '../ui/ScreenMap';
import { useAsync } from '../ui/useAsync';
import { useLanaiRevision } from './MonsterEditor';
import type { LanaiSession } from './session';

/** The thumbnail selected by MapStage +0x04; the layout and its texture travel together when copied. */
export async function lanaiStageThumbnail(session: LanaiSession, archive: string, hash: number) {
  const files = readSarc(await session.readLayout(archive, hash));
  const image = [...files.entries()].find(([name]) => /^timg\/.*\.bflim$/i.test(name));
  if (!image) throw new Error('サムネイル画像がありません');
  return readBflim(image[1]);
}

export function LanaiStageThumbnail({
  session,
  archive,
  hash,
  name,
}: {
  session: LanaiSession;
  archive: string;
  hash: number;
  name: string;
}): ReactNode {
  const revision = useLanaiRevision(session);
  const image = useAsync(() => lanaiStageThumbnail(session, archive, hash), [session, archive, hash, revision]);
  if (!image) return <span className="muted small">画像を読み込み中…</span>;
  if (image instanceof Error) return <span className="muted small">{image.message}</span>;
  return <img src={imageUrl(image)} width={image.width} height={image.height} alt={`${name} のサムネイル`} />;
}
