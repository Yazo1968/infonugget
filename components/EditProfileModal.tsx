import { useState, useRef, useCallback, useMemo, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../utils/supabase';
import { useAuth } from '../context/AuthContext';
import UserAvatar from './UserAvatar';

const MAX_IMAGE_SIZE = 512_000; // 500 KB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface EditProfileModalProps {
  darkMode: boolean;
  onClose: () => void;
}

export default function EditProfileModal({ darkMode, onClose }: EditProfileModalProps) {
  const { user, profile, refreshProfile, signOut } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [initials, setInitials] = useState(profile?.avatarInitials ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? '');
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Change password state
  const isEmailUser = user?.app_metadata?.provider === 'email';
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const passwordChecks = useMemo(() => ({
    minLength: newPassword.length >= 8,
    hasLower: /[a-z]/.test(newPassword),
    hasUpper: /[A-Z]/.test(newPassword),
    hasDigit: /\d/.test(newPassword),
    hasSymbol: /[^a-zA-Z0-9]/.test(newPassword),
  }), [newPassword]);
  const passwordValid = Object.values(passwordChecks).every(Boolean);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleInitialsChange = useCallback((value: string) => {
    // Allow only letters, max 2, auto-uppercase
    const cleaned = value.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase();
    setInitials(cleaned);
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Only PNG, JPEG, and WebP images are accepted.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError('Image must be under 500 KB.');
      return;
    }
    setError(null);
    setPreviewFile(file);
    setRemoveImage(false);
    const reader = new FileReader();
    reader.onload = () => setPreviewDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleRemoveImage = useCallback(() => {
    setPreviewFile(null);
    setPreviewDataUrl(null);
    setRemoveImage(true);
    setAvatarUrl('');
  }, []);

  // Preview profile for the avatar component
  const previewProfile: import('../context/AuthContext').UserProfile = {
    displayName,
    avatarInitials: initials || null,
    avatarUrl: previewDataUrl ?? (removeImage ? null : avatarUrl) ?? null,
    devMode: false,
  };

  const handleChangePassword = async () => {
    if (!passwordValid) return;
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password: newPassword });
      if (pwErr) throw new Error(pwErr.message);
      setPasswordSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setShowPasswordSection(false), 1500);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE' || !user) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Recursively list all files under user's prefix in a bucket
      const listAllFiles = async (bucket: string, prefix: string): Promise<string[]> => {
        const paths: string[] = [];
        const { data } = await supabase.storage.from(bucket).list(prefix);
        if (!data?.length) return paths;
        for (const item of data) {
          const fullPath = `${prefix}/${item.name}`;
          if (item.id) {
            // It's a file
            paths.push(fullPath);
          } else {
            // It's a folder — recurse
            const nested = await listAllFiles(bucket, fullPath);
            paths.push(...nested);
          }
        }
        return paths;
      };

      // Clean up storage buckets via Storage API (RPC can't access storage.objects)
      for (const bucket of ['avatars', 'pdfs', 'card-images']) {
        const paths = await listAllFiles(bucket, user.id);
        if (paths.length) {
          // Storage API allows max 1000 files per remove call
          for (let i = 0; i < paths.length; i += 1000) {
            await supabase.storage.from(bucket).remove(paths.slice(i, i + 1000));
          }
        }
      }
      // Delete all DB rows + auth user via RPC
      const { error: rpcErr } = await supabase.rpc('delete_user_account');
      if (rpcErr) throw new Error(rpcErr.message);
      // Account deleted — sign out and close
      await signOut();
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account.');
      setDeleting(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const trimmedName = displayName.trim();
    if (!trimmedName) { setError('Display name is required.'); return; }

    setSaving(true);
    setError(null);

    try {
      let newAvatarUrl = removeImage ? null : (avatarUrl || null);

      // Upload image if a new file was selected
      if (previewFile) {
        const ext = previewFile.name.split('.').pop()?.toLowerCase() ?? 'png';
        const path = `${user.id}/avatar.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(path, previewFile, { upsert: true, contentType: previewFile.type });
        if (uploadErr) throw new Error(uploadErr.message);

        // Get signed URL (1 year)
        const { data: urlData, error: urlErr } = await supabase.storage
          .from('avatars')
          .createSignedUrl(path, 365 * 24 * 60 * 60);
        if (urlErr) throw new Error(urlErr.message);
        newAvatarUrl = urlData.signedUrl;
      } else if (removeImage) {
        // Delete existing avatar file
        const { data: files } = await supabase.storage.from('avatars').list(user.id);
        if (files?.length) {
          await supabase.storage.from('avatars').remove(files.map(f => `${user.id}/${f.name}`));
        }
      }

      // Update profiles row
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({
          display_name: trimmedName,
          avatar_initials: initials || null,
          avatar_url: newAvatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (dbErr) throw new Error(dbErr.message);

      await refreshProfile();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className={`relative w-full max-w-sm mx-4 rounded-xl shadow-xl border p-6 ${
        darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'
      }`}>
        <h2 className={`text-base font-semibold mb-5 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
          Edit Profile
        </h2>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Avatar preview + upload */}
          <div className="flex items-center gap-4">
            <UserAvatar size={56} profile={previewProfile} email={user?.email} />
            <div className="flex-1 space-y-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`text-[12px] font-medium px-2.5 py-1 rounded transition-colors ${
                  darkMode
                    ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                }`}
              >
                Upload Image
              </button>
              {(avatarUrl || previewDataUrl) && !removeImage && (
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="block text-[11px] text-red-500 hover:text-red-400 transition-colors"
                >
                  Remove image
                </button>
              )}
              <p className={`text-[10px] ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                PNG, JPG, WebP. Max 500 KB.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }}
            />
          </div>

          {/* Drop zone (subtle) */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg py-3 text-center text-[11px] transition-colors ${
              darkMode
                ? 'border-zinc-700 text-zinc-500 hover:border-zinc-600'
                : 'border-zinc-200 text-zinc-400 hover:border-zinc-300'
            }`}
          >
            or drag & drop an image here
          </div>

          {/* Display name */}
          <div>
            <label className={`block text-[12px] font-medium mb-1 ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              className={`w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent ${
                darkMode
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-300 bg-white text-zinc-900'
              }`}
            />
          </div>

          {/* Custom initials */}
          <div>
            <label className={`block text-[12px] font-medium mb-1 ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>
              Custom Initials <span className={`font-normal ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>(max 2 letters)</span>
            </label>
            <input
              type="text"
              value={initials}
              onChange={(e) => handleInitialsChange(e.target.value)}
              maxLength={2}
              placeholder="e.g. JD"
              className={`w-24 px-3 py-1.5 border rounded-lg text-sm font-bold tracking-wider text-center focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent ${
                darkMode
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100 placeholder:text-zinc-600'
                  : 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400'
              }`}
            />
          </div>

          {/* Error */}
          {error && (
            <div className={`text-[12px] rounded-lg px-3 py-2 ${darkMode ? 'text-red-400 bg-red-900/20 border border-red-800' : 'text-red-500 bg-red-50 border border-red-200'}`}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
                darkMode
                  ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                  : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !displayName.trim()}
              className="px-4 py-1.5 text-[12px] font-medium rounded-lg bg-accent-blue text-white hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>

        {/* ── Change Password (email users only) ── */}
        {isEmailUser && (
          <div className={`mt-5 pt-4 border-t ${darkMode ? 'border-zinc-700' : 'border-zinc-200'}`}>
            {!showPasswordSection ? (
              <button
                type="button"
                onClick={() => setShowPasswordSection(true)}
                className={`text-[12px] font-medium flex items-center gap-1.5 transition-colors ${
                  darkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Change Password
              </button>
            ) : (
              <div className="space-y-3">
                <h3 className={`text-[12px] font-semibold ${darkMode ? 'text-zinc-200' : 'text-zinc-800'}`}>
                  Change Password
                </h3>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setPasswordError(null); setPasswordSuccess(false); }}
                  placeholder="New password"
                  className={`w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent ${
                    darkMode
                      ? 'border-zinc-600 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500'
                      : 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400'
                  }`}
                />
                {newPassword && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                    {([
                      ['minLength', '8+ characters'],
                      ['hasLower', 'Lowercase'],
                      ['hasUpper', 'Uppercase'],
                      ['hasDigit', 'Digit'],
                      ['hasSymbol', 'Symbol'],
                    ] as const).map(([key, label]) => (
                      <div key={key} className={passwordChecks[key] ? 'text-green-500' : (darkMode ? 'text-zinc-500' : 'text-zinc-400')}>
                        {passwordChecks[key] ? '\u2713' : '\u2022'} {label}
                      </div>
                    ))}
                  </div>
                )}
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                  placeholder="Confirm new password"
                  className={`w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent ${
                    darkMode
                      ? 'border-zinc-600 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500'
                      : 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400'
                  }`}
                />
                {passwordError && (
                  <div className={`text-[11px] ${darkMode ? 'text-red-400' : 'text-red-500'}`}>{passwordError}</div>
                )}
                {passwordSuccess && (
                  <div className="text-[11px] text-green-500">Password changed successfully.</div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowPasswordSection(false); setNewPassword(''); setConfirmPassword(''); setPasswordError(null); setPasswordSuccess(false); }}
                    className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                      darkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleChangePassword}
                    disabled={passwordSaving || !passwordValid || newPassword !== confirmPassword}
                    className="px-3 py-1 text-[11px] font-medium rounded bg-accent-blue text-white hover:brightness-110 disabled:opacity-50 transition-all"
                  >
                    {passwordSaving ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Delete Account ── */}
        <div className={`mt-5 pt-4 border-t ${darkMode ? 'border-zinc-700' : 'border-zinc-200'}`}>
          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-[12px] font-medium text-red-500 hover:text-red-400 flex items-center gap-1.5 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete Account
            </button>
          ) : (
            <div className="space-y-3">
              <div className={`text-[11px] leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                This will <span className="font-semibold text-red-500">permanently delete</span> your account and all data (projects, documents, cards, images). This cannot be undone.
              </div>
              <div>
                <label className={`block text-[11px] mb-1 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  Type <span className="font-bold">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => { setDeleteConfirmText(e.target.value); setDeleteError(null); }}
                  placeholder="DELETE"
                  className={`w-32 px-3 py-1.5 border rounded-lg text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent ${
                    darkMode
                      ? 'border-zinc-600 bg-zinc-800 text-zinc-100 placeholder:text-zinc-600'
                      : 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400'
                  }`}
                />
              </div>
              {deleteError && (
                <div className={`text-[11px] ${darkMode ? 'text-red-400' : 'text-red-500'}`}>{deleteError}</div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteError(null); }}
                  className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                    darkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteConfirmText !== 'DELETE'}
                  className="px-3 py-1 text-[11px] font-medium rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-all"
                >
                  {deleting ? 'Deleting...' : 'Delete My Account'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
