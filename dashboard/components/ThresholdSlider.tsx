export default function ThresholdSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
  suffix,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  suffix: string;
}) {
  return (
    <div className="mb-3.5 flex items-center gap-3">
      <label className="min-w-[140px] text-sm text-zinc-400">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="flex-1 accent-indigo-500"
      />
      <span className="min-w-[40px] text-right font-mono text-sm font-medium text-zinc-100">
        {value}
        {suffix}
      </span>
    </div>
  );
}
