import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { Avatar, Button, Card, Field } from '../components/ui';

/* Settings for the signed-in person: who they are and their password.
   Nothing here changes how tickets work. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One part of the settings card: a heading, a line about it, then its fields. */
function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={id}>
      <div className="settings-section-head">
        <h2 id={id} className="settings-section-title">
          {title}
        </h2>
        <p className="settings-section-desc">{description}</p>
      </div>
      {children}
    </section>
  );
}

const PHOTO_MAX = 2 * 1024 * 1024;

/** The profile picture: upload a new one or go back to initials. It applies straight away. */
function PhotoField({ name }: { name: string }) {
  const { currentUser, updateProfile, toast } = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return setError('Use a PNG, JPG, WebP or GIF image.');
    if (file.size > PHOTO_MAX) return setError('Use an image up to 2 MB.');
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      updateProfile({ photo: String(reader.result) });
      toast('Photo updated');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="settings-photo">
      <Avatar name={name} size={64} src={currentUser.photo} />
      <div className="settings-photo-main">
        <p className="settings-avatar-name">Profile picture</p>
        <p className={error ? 'field-error' : 'muted settings-photo-hint'}>{error || 'PNG, JPG, WebP or GIF, up to 2 MB.'}</p>
        <div className="settings-photo-actions">
          <Button size="sm" icon={<Upload size={15} />} onClick={() => picker.current?.click()}>
            {currentUser.photo ? 'Change photo' : 'Upload photo'}
          </Button>
          {currentUser.photo && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={15} />}
              onClick={() => {
                updateProfile({ photo: undefined });
                toast('Photo removed');
              }}
            >
              Remove
            </Button>
          )}
        </div>
        <input
          ref={picker}
          id="st-photo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function ProfileSection() {
  const { currentUser, updateProfile, toast } = useStore();
  const [name, setName] = useState(currentUser.name);
  const [title, setTitle] = useState(currentUser.title);
  const [email, setEmail] = useState(currentUser.email);
  const [phone, setPhone] = useState(currentUser.phone);
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    name: name.trim().length < 2 ? 'Add your name.' : '',
    email: EMAIL_RE.test(email.trim()) ? '' : 'Enter a valid email.',
  };
  const changed = name !== currentUser.name || title !== currentUser.title || email !== currentUser.email || phone !== currentUser.phone;

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.name || errors.email) return;
    updateProfile({ name: name.trim(), title: title.trim(), email: email.trim(), phone: phone.trim() });
    toast('Profile saved');
    setSubmitted(false);
  };

  return (
    <Section id="settings-profile" title="Profile" description="How you appear to your team and on tickets.">
      <form className="settings-form" onSubmit={save} noValidate>
        <PhotoField name={name || currentUser.name} />
        <div className="form-grid">
          <Field label="Full name" htmlFor="st-name" error={submitted ? errors.name : ''}>
            <input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Job title" htmlFor="st-title" optional>
            <input id="st-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" />
          </Field>
          <Field label="Email" htmlFor="st-email" error={submitted ? errors.email : ''}>
            <input id="st-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Phone" htmlFor="st-phone" optional>
            <input id="st-phone" type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </Field>
        </div>
        <div className="settings-actions">
          <Button variant="primary" type="submit" disabled={!changed}>
            Save profile
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const { toast } = useStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    current: current ? '' : 'Enter your current password.',
    next: next.length >= 8 ? '' : 'Use at least 8 characters.',
    confirm: confirm === next ? '' : 'The passwords don’t match.',
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.current || errors.next || errors.confirm) return;
    toast('Password updated');
    setCurrent('');
    setNext('');
    setConfirm('');
    setSubmitted(false);
  };

  return (
    <Section id="settings-password" title="Password" description="Use at least 8 characters. You stay signed in on this device.">
      <form className="settings-form" onSubmit={save} noValidate>
        <div className="form-grid">
          <div className="span-2">
            <Field label="Current password" htmlFor="st-current" error={submitted ? errors.current : ''}>
              <input id="st-current" type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
          </div>
          <Field label="New password" htmlFor="st-new" error={submitted ? errors.next : ''}>
            <input id="st-new" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" htmlFor="st-confirm" error={submitted ? errors.confirm : ''}>
            <input id="st-confirm" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        <div className="settings-actions">
          <Button variant="primary" type="submit" disabled={!current && !next && !confirm}>
            Update password
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function Settings() {
  return (
    <div className="page settings-page">
      <Card className="settings-card">
        <ProfileSection />
        <PasswordSection />
      </Card>
    </div>
  );
}
