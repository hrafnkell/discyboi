import { api, ApiError, type Me } from '../store/account';
import type { SyncState, ThrowStore } from '../store/throws';
import { h } from './dom';

const SYNC_TEXT: Record<SyncState, string> = {
  local: 'Saved in this browser',
  synced: 'Saved to your account',
  pending: 'Saving…',
  offline: 'Server unreachable: changes are kept here and sent when it’s back',
  signedout: 'Signed out: sign in again to keep saving to your account',
};

/**
 * Sign-in button and account menu for the top bar. Signed out (or with no server), throws stay in
 * this browser; signed in, the store switches to the account's history on the server.
 */
export class AccountPanel {
  readonly el: HTMLElement;
  private btn: HTMLButtonElement;
  private pop: HTMLElement;
  private me?: Me;
  private reachable = false;
  private mode: 'signin' | 'signup' = 'signin';
  private draft = { username: '', email: '' };

  constructor(
    private store: ThrowStore,
    private toast: (msg: string, kind?: 'err') => void,
  ) {
    this.btn = h('button.ghostbtn.acctbtn', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => this.toggle() }, 'Sign in');
    this.pop = h('div.acctpop', { role: 'dialog', 'aria-label': 'Account', hidden: true });
    this.el = h('div.acct', {}, this.btn, this.pop);
    document.addEventListener('pointerdown', (e) => !this.el.contains(e.target as Node) && this.close());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.close());
    store.onSync = () => this.renderBtn();
    store.onAuthLost = () => {
      this.toast('Signed out of your account: new throws are saved in this browser', 'err');
      this.me = this.me && { ...this.me, user: null };
      store.useLocal();
      this.renderBtn();
    };
    this.renderBtn();
    void this.init();
  }

  private async init() {
    try {
      this.me = await api.me();
      this.reachable = true;
      if (this.me.user) await this.store.useAccount(this.me.user, this.me.maxThrows);
    } catch {
      this.reachable = false; // static hosting or server down: local history only
    }
    this.renderBtn();
  }

  private renderBtn() {
    const u = this.store.account;
    this.btn.classList.toggle('signedin', !!u);
    this.btn.dataset.sync = this.store.sync;
    this.btn.textContent = u ? u.username : 'Sign in';
    this.btn.title = u ? SYNC_TEXT[this.store.sync] : this.reachable ? 'Sign in to keep a longer throw history on the server' : 'No server: throws are saved in this browser';
    if (!this.pop.hidden) this.renderPop();
  }

  private toggle() {
    if (this.pop.hidden) {
      this.pop.hidden = false;
      this.btn.setAttribute('aria-expanded', 'true');
      this.renderPop();
      this.pop.querySelector<HTMLInputElement>('input')?.focus();
    } else this.close();
  }

  private close() {
    if (this.pop.hidden) return;
    this.pop.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
  }

  private renderPop() {
    this.pop.replaceChildren(this.store.account ? this.accountView() : this.signInView());
  }

  private signInView(): HTMLElement {
    if (!this.reachable)
      return h('div', {}, h('h3', {}, 'No server'), h('p.muted', {}, 'Accounts need the discyboi server (bun run server). Throws are saved in this browser, newest 500.'), h('button.ghostbtn', { type: 'button', onclick: () => this.init().then(() => this.renderPop()) }, 'Try again'));
    const signup = this.me?.signup ?? false;
    const creating = signup && this.mode === 'signup';
    const user = h('input', { name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 32, autocapitalize: 'none', spellcheck: 'false', value: this.draft.username });
    const email = h('input', { name: 'email', type: 'email', autocomplete: 'email', maxlength: 254, autocapitalize: 'none', spellcheck: 'false', value: this.draft.email });
    const pass = h('input', { name: 'password', type: 'password', autocomplete: creating ? 'new-password' : 'current-password', required: true, minlength: creating ? 8 : undefined, maxlength: 256 });
    const msg = h('p.acctmsg', { role: 'alert' });
    // Switching views keeps what was typed.
    const switchTo = (mode: 'signin' | 'signup') => {
      this.draft = { username: user.value, email: email.value };
      this.mode = mode;
      this.renderPop();
      this.pop.querySelector<HTMLInputElement>('input')?.focus();
    };
    const submitBtn = h('button.connect', { type: 'submit' }, creating ? 'Create account' : 'Sign in');
    const otherBtn = signup
      ? h('button.ghostbtn', { type: 'button', onclick: () => switchTo(creating ? 'signin' : 'signup') }, creating ? 'I have an account' : 'Create account')
      : null;
    const form = h(
      'form.acctform',
      {},
      h('h3', {}, creating ? 'Create an account' : 'Your account'),
      h('p.muted', {}, `Signed out, throws are kept in this browser (newest 500). An account keeps up to ${(this.me?.maxThrows ?? 0).toLocaleString()} and shows them on every device.`),
      h('label', {}, 'Username', user),
      creating ? h('label', {}, h('span', {}, 'Email ', h('span.opt', {}, '(optional)')), email) : null,
      creating ? h('p.muted.small', {}, 'Only used to get you back in if you forget your password. Never shared.') : null,
      h('label', {}, creating ? 'Password (at least 8 characters)' : 'Password', pass),
      msg,
      h('div.acctrow', {}, submitBtn, otherBtn),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (creating && pass.value.length < 8) {
        msg.textContent = 'Password: at least 8 characters';
        return;
      }
      if (creating && email.value.trim() && !email.checkValidity()) {
        msg.textContent = 'That email address doesn’t look right';
        return;
      }
      for (const b of form.querySelectorAll('button')) b.disabled = true;
      msg.textContent = '';
      try {
        this.me = creating ? await api.signup(user.value.trim(), pass.value, email.value.trim()) : await api.login(user.value.trim(), pass.value);
        await this.store.useAccount(this.me.user!, this.me.maxThrows);
        this.mode = 'signin';
        this.draft = { username: '', email: '' };
        const local = this.store.localThrows().length;
        this.toast(creating ? `Account created. Welcome, ${this.me.user!.username}` : `Signed in as ${this.me.user!.username}`);
        if (local) this.toast(`${local} throws in this browser: upload them from the account menu`);
        this.close();
      } catch (err) {
        msg.textContent = err instanceof ApiError ? err.message : 'Something went wrong';
      } finally {
        for (const b of form.querySelectorAll('button')) b.disabled = false;
        this.renderBtn();
      }
    });
    return form;
  }

  /** The account's email: shown, and added, changed or removed in place. */
  private emailView(): HTMLElement {
    const cur = this.me?.user?.email ?? null;
    const wrap = h('div.acctemail');
    const show = () => {
      const edit = h('button.linkbtn', { type: 'button', onclick: () => editing() }, cur ? 'Change' : 'Add email');
      wrap.replaceChildren(
        h('p.muted', {}, cur ? h('span', {}, 'Email: ', h('span.acctemailaddr', {}, cur), ' ') : h('span', {}, 'No email: add one so you can get back in if you forget your password. '), edit),
      );
    };
    const editing = () => {
      const input = h('input', { type: 'email', autocomplete: 'email', maxlength: 254, autocapitalize: 'none', spellcheck: 'false', value: cur ?? '', placeholder: 'you@example.com' });
      const msg = h('p.acctmsg', { role: 'alert' });
      const save = h('button.connect', { type: 'submit' }, 'Save');
      const cancel = h('button.ghostbtn', { type: 'button', onclick: () => show() }, 'Cancel');
      const form = h('form.acctform', {}, h('label', {}, 'Email (leave empty to remove)', input), msg, h('div.acctrow', {}, save, cancel));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (input.value.trim() && !input.checkValidity()) {
          msg.textContent = 'That email address doesn’t look right';
          return;
        }
        save.disabled = cancel.disabled = true;
        try {
          const r = await api.email(input.value.trim());
          if (this.me?.user) this.me = { ...this.me, user: { ...this.me.user, email: r.email } };
          this.toast(r.email ? 'Email saved' : 'Email removed');
          this.renderPop();
        } catch (err) {
          msg.textContent = err instanceof ApiError ? err.message : 'Something went wrong';
          save.disabled = cancel.disabled = false;
        }
      });
      wrap.replaceChildren(form);
      input.focus();
    };
    show();
    return wrap;
  }

  private accountView(): HTMLElement {
    const u = this.store.account!;
    const local = this.store.localThrows().length;
    const n = this.store.all().length;
    const upload = h(
      'button.ghostbtn',
      {
        type: 'button',
        hidden: !local,
        title: 'Copies them; the browser copy stays for when you are signed out',
        onclick: async () => {
          upload.disabled = true;
          try {
            const added = await this.store.uploadLocal();
            this.toast(added ? `Uploaded ${added} throws` : 'Those throws are already in your account');
          } catch (err) {
            this.toast(`Upload failed: ${err instanceof Error ? err.message : err}`, 'err');
          } finally {
            upload.disabled = false;
          }
        },
      },
      `Upload ${local} throws from this browser`,
    );
    const out = h(
      'button.ghostbtn',
      {
        type: 'button',
        onclick: async () => {
          out.disabled = true;
          try {
            await api.logout();
          } catch {
            /* the cookie is cleared by the server; offline, the session just lapses */
          }
          this.store.useLocal();
          this.me = this.me && { ...this.me, user: null };
          this.toast('Signed out: showing the throws saved in this browser');
          this.close();
          this.renderBtn();
        },
      },
      'Sign out',
    );
    return h(
      'div',
      {},
      h('h3', {}, u.username),
      h('p', {}, h('span.syncdot', { 'data-sync': this.store.sync }), SYNC_TEXT[this.store.sync]),
      h('p.muted', {}, `${n.toLocaleString()} throws (up to ${this.store.capacity.toLocaleString()})`),
      this.emailView(),
      h('div.acctrow', {}, upload, out),
    );
  }
}
