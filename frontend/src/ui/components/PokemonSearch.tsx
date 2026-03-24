import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useGetPokemonByNameQuery } from '@/store/api/pokemon.api';
import { Button } from '@/ui/shadcn/ui/button';
import { Input } from '@/ui/shadcn/ui/input';

const schema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .regex(/^[a-z-]+$/, 'Lowercase letters and hyphens only'),
});

type FormData = z.infer<typeof schema>;

export function PokemonSearch() {
  const [searchName, setSearchName] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const {
    data: pokemon,
    isLoading,
    isError,
  } = useGetPokemonByNameQuery(searchName, {
    skip: !searchName,
  });

  const onSubmit = (data: FormData) => {
    setSearchName(data.name);
  };

  return (
    <div>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div>
          <Input placeholder="Enter pokemon name" {...register('name')} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Searching...' : 'Search'}
        </Button>
      </form>

      {isError && <p className="text-sm text-destructive">Pokemon not found.</p>}
      {pokemon && (
        <div>
          <h3>{pokemon.name}</h3>
          <img src={pokemon.sprites.front_default ?? undefined} alt={pokemon.name} />
        </div>
      )}
    </div>
  );
}
