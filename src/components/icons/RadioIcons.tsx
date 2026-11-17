import * as React from 'react';

export type RadioIconProps = React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  title?: string;
};

export type RadioIconName =
  | 'live-beacon'
  | 'play-signal'
  | 'pause-signal'
  | 'resync-live'
  | 'eq-sliders'
  | 'preset-wave'
  | 'blind-mask'
  | 'wave-marker'
  | 'react-fire'
  | 'react-hypnotic'
  | 'react-subbass'
  | 'react-goosebumps'
  | 'react-acid'
  | 'react-heart'
  | 'chat-ether'
  | 'shield-pow'
  | 'theme-prism'
  | 'volume-dsp';

interface RadioSvgFrameProps extends RadioIconProps {
  children: React.ReactNode;
}

const RadioSvgFrame: React.FC<RadioSvgFrameProps> = ({
  size = 24,
  title,
  children,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    role={title ? 'img' : 'presentation'}
    aria-hidden={title ? undefined : true}
    {...props}
  >
    {title && <title>{title}</title>}
    {children}
  </svg>
);

export const LiveBeaconIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <circle cx="12" cy="12" r="2" />
    <path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10" />
  </RadioSvgFrame>
);

export const PlaySignalIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="m8 5 11 7-11 7Z" />
  </RadioSvgFrame>
);

export const PauseSignalIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M8 5v14M16 5v14" />
  </RadioSvgFrame>
);

export const ResyncLiveIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M19 9a7 7 0 1 0 .2 5M19 4v5h-5" />
  </RadioSvgFrame>
);

export const EqSlidersIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M6 4v5m0 4v7M12 4v9m0 4v3M18 4v2m0 4v10M3 9h6m0 4h6m0-7h6" />
  </RadioSvgFrame>
);

export const PresetWaveIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M3 12h3l3-7 6 14 3-7h3" />
  </RadioSvgFrame>
);

export const BlindMaskIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M3 11a10 10 0 0 0 18 0M7 16l-2 3m7-2v4m5-5 2 3" />
  </RadioSvgFrame>
);

export const WaveMarkerIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M12 21V9m0 0 6-4-6-3v7M5 21h14" />
  </RadioSvgFrame>
);

export const ReactFireIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2 1-4 3-6 0 3 1 4 2 4 2-3 2-5 1-9Z" />
  </RadioSvgFrame>
);

export const ReactHypnoticIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M12 12c-2-2 1-5 3-3 4 3-1 9-6 6-6-4-1-13 6-11 8 2 7 14-1 16" />
  </RadioSvgFrame>
);

export const ReactSubbassIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M5 9v6m5-10v14m4-12v10m5-7v4" />
  </RadioSvgFrame>
);

export const ReactGoosebumpsIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
  </RadioSvgFrame>
);

export const ReactAcidIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="m13 3-8 11h6l-1 7 9-12h-6Z" />
  </RadioSvgFrame>
);

export const ReactHeartIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M12 20 4.5 13a5 5 0 0 1 7.5-6.5A5 5 0 0 1 19.5 13Z" />
  </RadioSvgFrame>
);

export const ChatEtherIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M20 12a8 8 0 0 1-8 8 8 8 0 0 1-4-1l-5 2 2-5a8 8 0 1 1 15-4Z" />
  </RadioSvgFrame>
);

export const ShieldPowIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
    <path d="m8 12 3 3 5-6" />
  </RadioSvgFrame>
);

export const ThemePrismIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4v16" />
  </RadioSvgFrame>
);

export const VolumeDspIcon: React.FC<RadioIconProps> = (props) => (
  <RadioSvgFrame {...props}>
    <path d="M3 9h4l5-4v14l-5-4H3Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
  </RadioSvgFrame>
);

export const RADIO_ICONS: Record<RadioIconName, React.FC<RadioIconProps>> = {
  'live-beacon': LiveBeaconIcon,
  'play-signal': PlaySignalIcon,
  'pause-signal': PauseSignalIcon,
  'resync-live': ResyncLiveIcon,
  'eq-sliders': EqSlidersIcon,
  'preset-wave': PresetWaveIcon,
  'blind-mask': BlindMaskIcon,
  'wave-marker': WaveMarkerIcon,
  'react-fire': ReactFireIcon,
  'react-hypnotic': ReactHypnoticIcon,
  'react-subbass': ReactSubbassIcon,
  'react-goosebumps': ReactGoosebumpsIcon,
  'react-acid': ReactAcidIcon,
  'react-heart': ReactHeartIcon,
  'chat-ether': ChatEtherIcon,
  'shield-pow': ShieldPowIcon,
  'theme-prism': ThemePrismIcon,
  'volume-dsp': VolumeDspIcon,
};

export interface RadioIconByNameProps extends RadioIconProps {
  name: RadioIconName;
}

export const RadioIcon: React.FC<RadioIconByNameProps> = ({ name, ...props }) => {
  const Component = RADIO_ICONS[name];
  return <Component {...props} />;
};

export default RADIO_ICONS;
