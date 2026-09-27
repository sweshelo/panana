// An "i" icon whose explanation shows on hover, focus or click (react-tooltip; one shared <Tooltip> in the shell, and
// one in each modal <dialog>, whose top layer would hide the shell's).
import { createContext, useContext, useId, type ReactNode } from 'react';
import { Tooltip } from 'react-tooltip';

export const INFO_TOOLTIP = 'info-tip';

/** Id of the tooltip the InfoTips below show in (a Dialog gives its own). */
const TooltipId = createContext(INFO_TOOLTIP);

export function InfoTip({ text }: { text: string }): ReactNode {
  const id = useContext(TooltipId);
  return (
    <span className="info-icon" role="button" tabIndex={0} aria-label={text} data-tooltip-id={id} data-tooltip-content={text}>i</span>
  );
}

/** The shared tooltip of the InfoTips (rendered once by the shell, and by each Dialog). Line breaks in the text are kept. */
export function InfoTooltip({ id = INFO_TOOLTIP, fixed = false }: { id?: string; fixed?: boolean }): ReactNode {
  return (
    <Tooltip
      id={id}
      positionStrategy={fixed ? 'fixed' : 'absolute'}
      className="info-tooltip"
      opacity={1}
      openEvents={{ mouseenter: true, focus: true, click: true }}
      closeEvents={{ mouseleave: true, blur: true }}
      globalCloseEvents={{ escape: true, clickOutsideAnchor: true }}
      render={({ content }) => <div className="info-tooltip-text">{content}</div>}
    />
  );
}

/**
 * InfoTips inside show in a tooltip rendered here: inside a modal <dialog> it is drawn in the dialog's top layer, and
 * placed against the viewport so the dialog's scrolling box does not clip it.
 */
export function InfoTipScope({ children }: { children: ReactNode }): ReactNode {
  const id = `${INFO_TOOLTIP}-${useId().replace(/:/g, '')}`;
  return (
    <TooltipId.Provider value={id}>
      {children}
      <InfoTooltip id={id} fixed />
    </TooltipId.Provider>
  );
}
