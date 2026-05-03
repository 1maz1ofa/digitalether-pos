import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "[]",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("renders admin shell and POS after redirect", async () => {
  render(<App />);
  expect(screen.getByText(/digitalether/i)).toBeInTheDocument();
  await waitFor(() => {
    expect(
      screen.getByRole("heading", { name: /point of sale/i })
    ).toBeInTheDocument();
  });
});
