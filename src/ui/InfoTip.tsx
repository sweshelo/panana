// An "i" icon whose explanation shows on hover, focus or click (react-tooltip; one shared <Tooltip> in the shell).
import type { ReactNode } from 'react';
import { Tooltip } from 'react-tooltip';

export const INFO_TOOLTIP = 'info-tip';

export function InfoTip({ text }: { text: string }): ReactNode {
  return (
    <span className="info-icon" role="button" tabIndex={0} aria-label={text} data-tooltip-id={INFO_TOOLTIP} data-tooltip-content={text}>i</span>
  );
}

/** The shared tooltip of every InfoTip (rendered once by the shell). Line breaks in the text are kept. */
export function InfoTooltip(): ReactNode {
  return (
    <Tooltip
      id={INFO_TOOLTIP}
      className="info-tooltip"
      opacity={1}
      openEvents={{ mouseenter: true, focus: true, click: true }}
      closeEvents={{ mouseleave: true, blur: true }}
      globalCloseEvents={{ escape: true, clickOutsideAnchor: true }}
      render={({ content }) => <div className="info-tooltip-text">{content}</div>}
    />
  );
}
