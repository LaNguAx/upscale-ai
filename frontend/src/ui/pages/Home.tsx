import { Counter } from '@/ui/components/Counter';
import { PokemonSearch } from '@/ui/components/PokemonSearch';

export function Home() {
  return (
    <div>
      <h1>Upscale AI</h1>
      <p>Enhance your images with the power of AI</p>
      <Counter />
      <PokemonSearch />
    </div>
  );
}
