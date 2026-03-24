import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { decrement, increment, incrementByAmount, selectCount } from '@/store/slices/counter.slice';
import { Button } from '@/ui/shadcn/ui/button';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';

export function Counter() {
  const count = useAppSelector(selectCount);
  const dispatch = useAppDispatch();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div>
        <Button variant="outline" size="icon-sm" onClick={() => dispatch(decrement())}>
          -
        </Button>
        <span>{count}</span>
        <Button variant="outline" size="icon-sm" onClick={() => dispatch(increment())}>
          +
        </Button>
      </div>
      <Button variant="default" onClick={() => dispatch(incrementByAmount(5))}>
        +5
      </Button>
      <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '8px' }}>
        {format(now, 'HH:mm:ss')}
      </p>
    </div>
  );
}
