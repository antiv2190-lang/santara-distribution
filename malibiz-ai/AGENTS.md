<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep private pages under a client-only `_authenticated` layout with a Cloud Auth getUser gate, because browser sessions are unavailable to public SSR.
- Use the generated browser Cloud client with shared Zod schemas, database constraints, and owner-scoped RLS, because the data API is directly callable.
- Keep a single root Auth subscriber and clear Query caches before sign-out, because private data must not survive identity transitions.
- Import legacy browser leads only explicitly and idempotently without deleting originals, because shared-device data must not be silently assigned to an account.
