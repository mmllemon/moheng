import { useEffect, useState } from 'react';
import DatePicker from './DatePicker';

type DateTimeFieldProps = {
  value?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
};

function splitValue(value: string | undefined) {
  const raw = value ?? '';
  return { date: raw.slice(0, 10), time: raw.slice(11, 16) };
}

export default function DateTimeField({ value, onChange, onBlur, name, id, disabled, required }: DateTimeFieldProps) {
  const { date, time } = splitValue(value);
  const [timeDraft, setTimeDraft] = useState(time);

  useEffect(() => {
    setTimeDraft(time);
  }, [time]);

  function emit(nextDate: string, nextTime: string) {
    if (!nextDate) { onChange(''); return; }
    onChange(`${nextDate}T${nextTime || '09:00'}`);
  }

  function handleTimeChange(raw: string) {
    let next = raw.replace(/[^\d:]/g, '').slice(0, 5);
    if (!next.includes(':') && next.length === 4) next = `${next.slice(0, 2)}:${next.slice(2)}`;
    setTimeDraft(next);
    if (date) onChange(`${date}T${next}`);
  }

  function handleTimeBlur() {
    let next = timeDraft.trim();
    if (/^\d{1,2}:\d{1,2}$/.test(next)) {
      const [hours, minutes] = next.split(':');
      next = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
      setTimeDraft(next);
    }
    if (/^\d{2}:\d{2}$/.test(next) && date) onChange(`${date}T${next}`);
    onBlur?.();
  }

  return <div className="date-time-field">
    <DatePicker
      value={date}
      onChange={(event) => emit(event.target.value, timeDraft || time || '09:00')}
      onBlur={onBlur}
      disabled={disabled}
      required={required}
      aria-label="外部确认日期"
    />
    <div className="date-time-time">
      <input
        id={id}
        name={name}
        value={timeDraft}
        onChange={(event) => handleTimeChange(event.target.value)}
        onBlur={handleTimeBlur}
        placeholder="HH:mm"
        inputMode="numeric"
        maxLength={5}
        pattern="[0-2][0-9]:[0-5][0-9]"
        disabled={disabled}
        required={required}
        aria-label="外部确认时间（24 小时制）"
      />
    </div>
  </div>;
}
