import { useEffect, useState } from "react";

function App() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/")
      .then(res => res.json())
      .then(data => setMessage(data.message));
  }, []);

  return (
    <div>
      <h1>React Client</h1>
      <p>{message}</p>
    </div>
  );
}

export default App;