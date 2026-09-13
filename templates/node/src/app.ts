import {
  createApp,
  FormBodyError,
  readFormDataWithinLimit,
  redirect,
} from 'workstar-app';
import { render as homeView } from '../.workstar/generated/views/home.js';
import { render as thanksView } from '../.workstar/generated/views/thanks.js';

export const app = createApp({
  routes: [
    {
      name: 'home',
      path: '/',
      page: () => ({
        lang: 'en',
        title: 'Workstar on Node.js',
        description: 'A portable, server-rendered Workstar starter.',
        stylesheets: ['/style.css', '/workstar.css'],
        content: homeView({}),
      }),
    },
    {
      name: 'contact',
      path: '/contact',
      action: async ({ request }: { request: Request }) => {
        let form: FormData;
        try {
          form = await readFormDataWithinLimit(request, 8 * 1024);
        } catch (error) {
          if (error instanceof FormBodyError) {
            return new Response(error.message, { status: error.status });
          }
          throw error;
        }
        const name = form.get('name');
        if (typeof name !== 'string' || !name.trim() || name.length > 80) {
          return new Response('Enter a name of at most 80 characters.', {
            status: 400,
          });
        }
        return redirect('/thanks');
      },
    },
    {
      name: 'thanks',
      path: '/thanks',
      page: () => ({
        lang: 'en',
        title: 'Thank you',
        stylesheets: ['/style.css', '/workstar.css'],
        content: thanksView({}),
      }),
    },
  ],
});
