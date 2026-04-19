// <img> wrapper for a reagent sprite, with graceful fallback to a colored
// dot if no sprite exists (or didn't get copied into public/data/).

import { reagentSpriteUrl } from '../data/sprite-url';
import { useData } from '../data/store';

export function ReagentSprite({
  reagentId,
  size = 32,
}: {
  reagentId: string;
  size?: number;
}) {
  const data = useData();
  const url = reagentSpriteUrl(data.sprites, reagentId);
  const reagent = data.reagentsById.get(reagentId);
  const color = reagent?.color ?? '#44556a';

  if (!url) {
    return (
      <span
        className="reagent-sprite reagent-sprite-fallback"
        role="img"
        aria-label={`${reagentId} sprite (missing)`}
        style={{
          background: color,
          width: size,
          height: size,
          display: 'inline-block',
          borderRadius: 4,
          verticalAlign: 'middle',
        }}
      />
    );
  }
  return (
    <img
      className="reagent-sprite"
      src={url}
      width={size}
      height={size}
      alt={`${reagentId} sprite`}
      style={{ imageRendering: 'pixelated', verticalAlign: 'middle' }}
    />
  );
}
